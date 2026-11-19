import { Hono, type Context } from "hono";
import { z } from "zod";
import { CABINS, FareSchema, SearchRequestSchema, type QuotaStatus, type SearchEvent, type TripPlan } from "@farescope/shared";
import { QueryCache } from "./cache.ts";
import { PriceHistory, WatchStore } from "./history.ts";
import { QuotaGuard } from "./quota.ts";
import { dailyPruner } from "./prune.ts";
import type { SqlDb } from "./sql.ts";
import { TripStore } from "./trips.ts";
import type { FlightProvider, StayProvider } from "./providers/types.ts";
import { fareDetails } from "./search/details.ts";
import { runSearch } from "./search/run.ts";
import { lookupStays } from "./search/stays.ts";
import { buildPriceTrend } from "./search/trend.ts";
import { checkWatch, MAX_WATCHES, newWatch } from "./search/watch.ts";

/**
 * The HTTP API as a runtime-neutral Hono app: no Node-only imports, so the same routes run under
 * Node (app.ts, local dev and tests) and on Cloudflare Workers (worker.ts, production).
 */
export interface ApiSettings {
  monthlyBudget: number;
  dailyClientBudget: number;
  perSearchBudget: number;
  freeCallCap: number;
}

export interface ApiDeps {
  db: SqlDb;
  settings: ApiSettings;
  flights: FlightProvider;
  stays: StayProvider;
  /** The caller's IP (quota key). Each runtime knows where to find it. */
  clientIp: (c: Context) => string;
  /**
   * Optional gate before routes that may spend live quota (bot check). Return a Response to
   * refuse the request, or undefined to allow it.
   */
  liveGate?: (c: Context) => Promise<Response | undefined>;
  /** Extra routes (e.g. the bot-check token exchange). */
  extend?: (app: Hono) => void;
  log?: (message: string, error?: unknown) => void;
}

const CLIENT_ID = /^[a-zA-Z0-9-]{8,64}$/;

const StayQuerySchema = z.object({
  airport: z.string().regex(/^[A-Z]{3}$/),
  location: z.string().trim().min(2).max(160).optional(),
  checkIn: z.string().date(),
  checkOut: z.string().date(),
  adults: z.coerce.number().int().min(1).max(9).default(1),
});

const TripInput = z.object({
  name: z.string().min(1).max(120),
  adults: z.number().int().min(1).max(9).optional(),
  fare: z.object({ id: z.string(), price: z.number() }).passthrough(),
  stay: z.object({ id: z.string(), total: z.number() }).passthrough().optional(),
  lodging: z.array(z.object({
    id: z.string(), place: z.string().trim().min(1).max(160),
    checkIn: z.string().date(), checkOut: z.string().date(),
    stay: z.object({ id: z.string(), total: z.number().nonnegative(), checkIn: z.string().date(), checkOut: z.string().date() }).passthrough().optional(),
    ownCost: z.number().nonnegative().optional(),
  }).refine(stop => stop.checkOut > stop.checkIn && (!stop.stay ||
    (stop.stay.checkIn === stop.checkIn && stop.stay.checkOut === stop.checkOut)))).max(30).optional(),
  notes: z.string().max(5000).optional(),
  search: SearchRequestSchema.optional(),
});

const DetailsInput = z.object({
  fare: FareSchema,
  cabin: z.enum(CABINS),
  maxStops: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]),
  adults: z.number().int().min(1).max(9),
  airlines: z.array(z.string().regex(/^[A-Z0-9]{2}$/)).max(20).optional(),
});
const TrendInput = z.object({ fare: FareSchema, peers: z.array(FareSchema).max(60).default([]) });
const WatchInput = z.object({ fare: FareSchema, cabin: z.enum(CABINS), adults: z.number().int().min(1).max(9) });

async function body(c: Context): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

export function createApi(deps: ApiDeps): Hono {
  const { db, settings, flights, stays } = deps;
  const cache = new QueryCache(db);
  const quota = new QuotaGuard(db, { monthlyBudget: settings.monthlyBudget, dailyClientBudget: settings.dailyClientBudget });
  const trips = new TripStore(db);
  const watches = new WatchStore(db);
  const priceHistory = new PriceHistory(db);
  /** Quota is keyed by IP (not spoofable like a header). */
  const clientKey = (c: Context) => `ip:${deps.clientIp(c)}`;
  /** Trips and watches are keyed by the browser's anonymous id until real accounts exist. */
  const ownerId = (c: Context) => {
    const h = c.req.header("x-client-id");
    return h && CLIENT_ID.test(h) ? h : undefined;
  };
  const missingOwner = (c: Context) => c.json({ error: "Missing X-Client-Id" }, 400);
  const gate = async (c: Context) => (flights.live && deps.liveGate ? deps.liveGate(c) : undefined);

  const app = new Hono();
  // Retention: delete IP-keyed counters after 31 days (checked at most once a day).
  const prune = dailyPruner(db);
  app.use(async (_c, next) => {
    try { prune(); } catch (e) { deps.log?.("prune failed", e); }
    await next();
  });
  deps.extend?.(app);

  app.get("/api/health", (c) => c.json({ ok: true, provider: flights.name, live: flights.live }));

  app.get("/api/quota", (c) => c.json({ provider: flights.name, live: flights.live, ...quota.status(clientKey(c)) } satisfies QuotaStatus));

  app.post("/api/search", async (c) => {
    const parsed = SearchRequestSchema.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
    const refused = await gate(c);
    if (refused) return refused;

    // The browser going away aborts the search, so no more quota is spent on it.
    const abort = new AbortController();
    c.req.raw.signal?.addEventListener("abort", () => abort.abort());
    const encoder = new TextEncoder();
    const clientId = clientKey(c);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (e: SearchEvent) => {
          if (abort.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch {
            abort.abort();
          }
        };
        try {
          await runSearch(parsed.data, {
            provider: flights,
            cache,
            quota,
            clientId,
            perSearchBudget: settings.perSearchBudget,
            freeCallCap: settings.freeCallCap,
            signal: abort.signal,
          }, emit);
        } catch (e) {
          deps.log?.("search failed", e);
          emit({ type: "error", message: "Search failed unexpectedly." });
        }
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });

  app.get("/api/stays", async (c) => {
    const parsed = StayQuerySchema.safeParse(c.req.query());
    if (!parsed.success || parsed.data.checkOut <= parsed.data.checkIn) return c.json({ error: "Invalid stay query" }, 400);
    const refused = await gate(c);
    if (refused) return refused;
    const result = await lookupStays(parsed.data, stays, cache, quota, clientKey(c), Infinity, new Date());
    if (result.status) return c.json({ error: result.error }, result.status as 429);
    return c.json({ stays: result.stays, cached: result.cached, stale: result.stale });
  });

  app.get("/api/trips", (c) => {
    const owner = ownerId(c);
    return owner ? c.json({ trips: trips.list(owner) }) : missingOwner(c);
  });
  app.post("/api/trips", async (c) => {
    const owner = ownerId(c);
    if (!owner) return missingOwner(c);
    const parsed = TripInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "Invalid trip" }, 400);
    return c.json({ trip: trips.create(owner, parsed.data as unknown as Omit<TripPlan, "id" | "createdAt" | "total">) });
  });
  app.delete("/api/trips/:id", (c) => {
    const owner = ownerId(c);
    if (!owner) return missingOwner(c);
    return trips.remove(owner, c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404);
  });
  app.put("/api/trips/:id", async (c) => {
    const owner = ownerId(c);
    if (!owner) return missingOwner(c);
    const parsed = TripInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "Invalid trip" }, 400);
    const trip = trips.update(owner, c.req.param("id"), parsed.data as unknown as Omit<TripPlan, "id" | "createdAt" | "total">);
    return trip ? c.json({ trip }) : c.json({ error: "Trip not found" }, 404);
  });

  // Real itineraries for a date-grid (price-only) fare.
  app.post("/api/fare-details", async (c) => {
    const parsed = DetailsInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "Invalid fare" }, 400);
    const refused = await gate(c);
    if (refused) return refused;
    return c.json(await fareDetails(parsed.data, { provider: flights, cache, quota, clientId: clientKey(c) }));
  });

  app.post("/api/price-trend", async (c) => {
    const parsed = TrendInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "Invalid fare" }, 400);
    const live = flights.live;
    const trend = buildPriceTrend(parsed.data.fare, parsed.data.peers, {
      provider: flights,
      cache,
      storedHistory: live ? (fare) => priceHistory.forFare(fare) : undefined,
      storedSeries: live ? () => priceHistory.series() : undefined,
    });
    return c.json({ trend });
  });

  app.get("/api/watches", (c) => {
    const owner = ownerId(c);
    return owner ? c.json({ watches: watches.list(owner) }) : missingOwner(c);
  });
  app.post("/api/watches", async (c) => {
    const owner = ownerId(c);
    if (!owner) return missingOwner(c);
    const parsed = WatchInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "Invalid watch" }, 400);
    if (watches.count(owner) >= MAX_WATCHES) return c.json({ error: `You can watch up to ${MAX_WATCHES} flights.` }, 409);
    const watch = newWatch(parsed.data.fare, parsed.data.cabin, parsed.data.adults, crypto.randomUUID());
    watches.save(owner, watch);
    return c.json({ watch });
  });
  app.delete("/api/watches/:id", (c) => {
    const owner = ownerId(c);
    if (!owner) return missingOwner(c);
    return watches.remove(owner, c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404);
  });
  /** Re-price this browser's watches (cache-first; live calls go through the quota guard). */
  app.post("/api/watches/check", async (c) => {
    const owner = ownerId(c);
    if (!owner) return missingOwner(c);
    // Without a bot-check pass, watches are re-priced from the cache only.
    const refused = await gate(c);
    const out = [];
    for (const watch of watches.list(owner)) {
      if (watch.status === "departed") { out.push(watch); continue; }
      const result = await checkWatch(watch, {
        provider: flights,
        cache,
        quota: refused ? { remaining: () => 0, tryConsume: () => ({ ok: false, reason: "daily" }) } : quota,
        clientId: clientKey(c),
      });
      if (result.watch !== watch) watches.save(owner, result.watch);
      out.push(result.watch);
    }
    return c.json({ watches: out });
  });

  return app;
}
