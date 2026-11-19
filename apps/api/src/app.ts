import Fastify, { type FastifyRequest } from "fastify";
import { join } from "node:path";
import { z } from "zod";
import { CABINS, FareSchema, SearchRequestSchema, type QuotaStatus, type SearchEvent, type TripPlan } from "@farescope/shared";
import { randomUUID } from "node:crypto";
import { PriceHistory, WatchStore } from "./history.ts";
import { buildPriceTrend } from "./search/trend.ts";
import { checkWatch, MAX_WATCHES, newWatch } from "./search/watch.ts";
import { QueryCache } from "./cache.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db.ts";
import { createMockFlightProvider, createMockStayProvider } from "./providers/mock.ts";
import { createSerpApiFlightProvider } from "./providers/serpapi-flights.ts";
import { createSerpApiStayProvider } from "./providers/serpapi-hotels.ts";
import { createTravelpayoutsFlightProvider } from "./providers/travelpayouts-flights.ts";
import { createNoStayProvider } from "./providers/none.ts";
import type { FlightProvider, StayProvider } from "./providers/types.ts";
import { lookupStays } from "./search/stays.ts";
import { QuotaGuard } from "./quota.ts";
import { runSearch } from "./search/run.ts";
import { TripStore } from "./trips.ts";

export interface AppOverrides {
  flights?: FlightProvider;
  stays?: StayProvider;
  dbPath?: string;
}

const CLIENT_ID = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * Quota is keyed by IP (not spoofable like a header). Trips are keyed by the browser's anonymous
 * id until real accounts exist.
 */
function clientKey(req: FastifyRequest): string {
  return `ip:${req.ip}`;
}
function ownerId(req: FastifyRequest): string | undefined {
  const h = req.headers["x-client-id"];
  return typeof h === "string" && CLIENT_ID.test(h) ? h : undefined;
}

export function buildApp(cfg: Config, overrides: AppOverrides = {}) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true });
  const db = openDb(overrides.dbPath ?? join(cfg.dataDir, "farescope.sqlite"));
  const cache = new QueryCache(db);
  const quota = new QuotaGuard(db, { monthlyBudget: cfg.monthlyBudget, dailyClientBudget: cfg.dailyClientBudget });
  const trips = new TripStore(db);
  const watches = new WatchStore(db);
  const priceHistory = new PriceHistory(db);
  const flights =
    overrides.flights ??
    (cfg.provider === "serpapi"
      ? createSerpApiFlightProvider({ apiKey: cfg.serpapiKey })
      : cfg.provider === "travelpayouts"
        ? createTravelpayoutsFlightProvider({ token: cfg.travelpayoutsToken, marker: cfg.travelpayoutsMarker || undefined })
        : createMockFlightProvider());
  // Real flights never get paired with simulated hotel prices: without a lodging source the app
  // shows "lodging prices unavailable" plus booking links instead.
  const stays =
    overrides.stays ??
    (cfg.serpapiKey && cfg.provider !== "mock"
      ? createSerpApiStayProvider({ apiKey: cfg.serpapiKey })
      : cfg.provider === "mock"
        ? createMockStayProvider()
        : createNoStayProvider());

  app.addHook("onClose", async () => db.close());

  app.get("/api/health", async () => ({ ok: true, provider: flights.name, live: flights.live }));

  app.get("/api/quota", async (req): Promise<QuotaStatus> => ({ provider: flights.name, live: flights.live, ...quota.status(clientKey(req)) }));

  app.post("/api/search", async (req, reply) => {
    const parsed = SearchRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });

    const abort = new AbortController();
    // Note: req.raw "close" fires as soon as the body is read; the response's "close" before it
    // finished means the browser actually went away.
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) abort.abort();
    });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const emit = (e: SearchEvent) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    try {
      await runSearch(
        parsed.data,
        {
          provider: flights,
          stays,
          cache,
          quota,
          clientId: clientKey(req),
          perSearchBudget: cfg.perSearchBudget,
          freeCallCap: cfg.freeCallCap,
          signal: abort.signal,
        },
        emit,
      );
    } catch (e) {
      req.log.error(e);
      emit({ type: "error", message: "Search failed unexpectedly." });
    }
    reply.raw.end();
  });

  const StayQuerySchema = z.object({
    airport: z.string().regex(/^[A-Z]{3}$/),
    location: z.string().trim().min(2).max(160).optional(),
    checkIn: z.string().date(),
    checkOut: z.string().date(),
    adults: z.coerce.number().int().min(1).max(9).default(1),
  });

  app.get("/api/stays", async (req, reply) => {
    const parsed = StayQuerySchema.safeParse(req.query);
    if (!parsed.success || parsed.data.checkOut <= parsed.data.checkIn) return reply.code(400).send({ error: "Invalid stay query" });
    const result = await lookupStays(parsed.data, stays, cache, quota, clientKey(req), Infinity, new Date());
    if (result.status) return reply.code(result.status).send({ error: result.error });
    return { stays: result.stays, cached: result.cached, stale: result.stale };
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

  app.get("/api/trips", async (req, reply) => {
    const owner = ownerId(req);
    if (!owner) return reply.code(400).send({ error: "Missing X-Client-Id" });
    return { trips: trips.list(owner) };
  });

  app.post("/api/trips", async (req, reply) => {
    const owner = ownerId(req);
    if (!owner) return reply.code(400).send({ error: "Missing X-Client-Id" });
    const parsed = TripInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid trip" });
    return { trip: trips.create(owner, parsed.data as unknown as Omit<TripPlan, "id" | "createdAt" | "total">) };
  });

  app.delete<{ Params: { id: string } }>("/api/trips/:id", async (req, reply) => {
    const owner = ownerId(req);
    if (!owner) return reply.code(400).send({ error: "Missing X-Client-Id" });
    return trips.remove(owner, req.params.id) ? { ok: true } : reply.code(404).send({ error: "Not found" });
  });
  app.put<{ Params: { id: string } }>("/api/trips/:id", async (req, reply) => {
    const owner = ownerId(req);
    if (!owner) return reply.code(400).send({ error: "Missing X-Client-Id" });
    const parsed = TripInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid trip" });
    const trip = trips.update(owner, req.params.id, parsed.data as unknown as Omit<TripPlan, "id" | "createdAt" | "total">);
    return trip ? { trip } : reply.code(404).send({ error: "Trip not found" });
  });

  // ---- Price predictions ----
  const TrendInput = z.object({ fare: FareSchema, peers: z.array(FareSchema).max(60).default([]) });
  app.post("/api/price-trend", async (req, reply) => {
    const parsed = TrendInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid fare" });
    const live = flights.live;
    const trend = buildPriceTrend(parsed.data.fare, parsed.data.peers, {
      provider: flights,
      cache,
      storedHistory: live ? (fare) => priceHistory.forFare(fare) : undefined,
      storedSeries: live ? () => priceHistory.series() : undefined,
    });
    return { trend };
  });

  // ---- Price watches (in-app alerts) ----
  const WatchInput = z.object({ fare: FareSchema, cabin: z.enum(CABINS), adults: z.number().int().min(1).max(9) });
  app.get("/api/watches", async (req, reply) => {
    const owner = ownerId(req);
    if (!owner) return reply.code(400).send({ error: "Missing X-Client-Id" });
    return { watches: watches.list(owner) };
  });
  app.post("/api/watches", async (req, reply) => {
    const owner = ownerId(req);
    if (!owner) return reply.code(400).send({ error: "Missing X-Client-Id" });
    const parsed = WatchInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid watch" });
    if (watches.count(owner) >= MAX_WATCHES) return reply.code(409).send({ error: `You can watch up to ${MAX_WATCHES} flights.` });
    const watch = newWatch(parsed.data.fare, parsed.data.cabin, parsed.data.adults, randomUUID());
    watches.save(owner, watch);
    return { watch };
  });
  app.delete<{ Params: { id: string } }>("/api/watches/:id", async (req, reply) => {
    const owner = ownerId(req);
    if (!owner) return reply.code(400).send({ error: "Missing X-Client-Id" });
    return watches.remove(owner, req.params.id) ? { ok: true } : reply.code(404).send({ error: "Not found" });
  });
  /** Re-price this browser's watches (cache-first; live calls go through the quota guard). */
  app.post("/api/watches/check", async (req, reply) => {
    const owner = ownerId(req);
    if (!owner) return reply.code(400).send({ error: "Missing X-Client-Id" });
    const out = [];
    for (const watch of watches.list(owner)) {
      if (watch.status === "departed") { out.push(watch); continue; }
      const result = await checkWatch(watch, { provider: flights, cache, quota, clientId: clientKey(req) });
      if (result.watch !== watch) watches.save(owner, result.watch);
      out.push(result.watch);
    }
    return { watches: out };
  });

  return app;
}
