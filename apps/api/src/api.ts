import { Hono, type Context } from "hono";
import { z } from "zod";
import { CABINS, FareSchema, nearestAirport, SearchRequestSchema, type QuotaStatus, type SearchEvent, type TripPlan } from "@farescope/shared";
import { QueryCache } from "./cache.ts";
import { PriceHistory, WatchStore } from "./history.ts";
import { QuotaGuard } from "./quota.ts";
import { dailyPruner } from "./prune.ts";
import { isPro, SubscriptionStore } from "./subscriptions.ts";
import { subscriptionUpdate, verifyStripeSignature } from "./stripe.ts";
import type { BillingDeps } from "./settings.ts";
import type { SqlDb } from "./sql.ts";
import { TripStore } from "./trips.ts";
import type { FlightProvider, StayProvider } from "./providers/types.ts";
import { fareDetails } from "./search/details.ts";
import { returnFlights } from "./search/returns.ts";
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
  /** Live lookups per signed-in account per month. */
  accountMonthlyBudget?: number;
  /** Site origins that may receive Stripe return links (localhost is always allowed). */
  siteOrigins?: string[];
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
  /** Sign-in check (Clerk): session token → user id, or undefined if invalid. Absent = no accounts. */
  verifyUser?: (token: string) => Promise<string | undefined>;
  /** Tripica Pro via Stripe. Absent = no paid plan. Needs accounts. */
  billing?: BillingDeps;
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
  const subscriptions = new SubscriptionStore(db);
  const billing = deps.verifyUser ? deps.billing : undefined;
  const quota = new QuotaGuard(db, {
    monthlyBudget: settings.monthlyBudget,
    dailyClientBudget: settings.dailyClientBudget,
    accountMonthlyBudget: settings.accountMonthlyBudget,
    // Pro subscribers get their plan's allowance; a free trial gets a smaller one.
    accountBudget: billing
      ? (clientId) => {
          const sub = subscriptions.get(clientId.slice("user:".length));
          if (!isPro(sub)) return undefined;
          return sub?.status === "trialing" ? billing.trialBudget : billing.proMonthlyBudget;
        }
      : undefined,
  });
  const trips = new TripStore(db);
  const watches = new WatchStore(db);
  const priceHistory = new PriceHistory(db);
  /** Signed-in user per request (set by the auth middleware below). */
  const users = new WeakMap<Request, string>();
  const userOf = (c: Context) => users.get(c.req.raw);
  const accounts = !!deps.verifyUser;
  /** Quota: the account when signed in, else the IP (not spoofable like a header). */
  const clientKey = (c: Context) => {
    const user = userOf(c);
    return user ? `user:${user}` : `ip:${deps.clientIp(c)}`;
  };
  /** Visitors without an account get a "sign in for more" hint when they hit their limit. */
  const signInHint = (c: Context) => accounts && !userOf(c);
  /** Trips and watches: the account when signed in, else this browser's anonymous id. */
  const browserId = (c: Context) => {
    const h = c.req.header("x-client-id");
    return h && CLIENT_ID.test(h) ? h : undefined;
  };
  const ownerId = (c: Context) => {
    const user = userOf(c);
    return user ? `user:${user}` : browserId(c);
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
  // Sign-in: a valid Clerk session token makes this request the account's. A token that doesn't
  // verify (expired, wrong site) is refused so the browser can refresh it, instead of silently
  // falling back to the visitor's limits.
  app.use("/api/*", async (c, next) => {
    const header = c.req.header("authorization");
    if (header && deps.verifyUser) {
      const token = /^Bearer (.{20,8192})$/.exec(header)?.[1];
      const user = token ? await deps.verifyUser(token) : undefined;
      if (!user) return c.json({ error: "Your sign-in expired. Please sign in again.", signIn: true }, 401);
      users.set(c.req.raw, user);
    }
    await next();
  });
  deps.extend?.(app);

  app.get("/api/health", (c) => c.json({ ok: true, provider: flights.name, live: flights.live }));

  /**
   * The visitor's nearest airport, to pre-fill the search. Uses the approximate location the
   * hosting platform attaches (Cloudflare: x-visitor-geo, set by the Worker); nothing is stored.
   */
  app.get("/api/locate", (c) => {
    const [lat, lng] = (c.req.header("x-visitor-geo") ?? "").split(",").map(Number);
    const airport = lat !== undefined && lng !== undefined ? nearestAirport(lat, lng) : undefined;
    c.header("Cache-Control", "private, no-store");
    return c.json(airport ? { airport: airport.iata, city: airport.city, country: airport.country } : {});
  });

  app.get("/api/quota", (c) => {
    const user = userOf(c);
    const pro = !!user && isPro(subscriptions.get(user));
    return c.json({ provider: flights.name, live: flights.live, accounts, billing: !!billing, pro, ...quota.status(clientKey(c)) } satisfies QuotaStatus);
  });

  // ---- Tripica Pro (Stripe) ----
  /** Where Stripe should send the browser back to: the caller's site, if it's one of ours. */
  const returnOrigin = (c: Context) => {
    const origin = c.req.header("origin") ?? "";
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    return local || (settings.siteOrigins ?? []).includes(origin) ? origin : undefined;
  };
  /** Re-read a subscription from Stripe at most every 10 minutes (renewals, cancellations). */
  const REFRESH_MS = 10 * 60_000;
  const refreshed = async (user: string) => {
    let sub = subscriptions.get(user);
    if (billing && sub?.subscriptionId && Date.now() - (sub.updatedAt ?? 0) > REFRESH_MS) {
      try {
        const u = await billing.stripe.subscription(sub.subscriptionId);
        if (u && u.userId === user) sub = subscriptions.apply(u);
      } catch (e) {
        deps.log?.("stripe refresh failed", e);
      }
    }
    return sub;
  };
  app.get("/api/billing", async (c) => {
    const user = userOf(c);
    if (!billing) return c.json({ enabled: false });
    if (!user) return c.json({ enabled: true, signedIn: false });
    const sub = await refreshed(user);
    return c.json({
      enabled: true,
      signedIn: true,
      pro: isPro(sub),
      status: sub?.status ?? null,
      plan: sub?.plan ?? null,
      trialEnd: sub?.trialEnd ?? null,
      periodEnd: sub?.periodEnd ?? null,
      canTrial: !sub?.trialUsed,
      canManage: !!sub?.customerId,
    });
  });
  app.post("/api/billing/checkout", async (c) => {
    const user = userOf(c);
    if (!billing) return c.json({ error: "Pro isn't available yet." }, 404);
    if (!user) return c.json({ error: "Sign in first.", signIn: true }, 401);
    const parsed = z.object({ plan: z.enum(["monthly", "yearly"]) }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "Choose monthly or yearly." }, 400);
    const origin = returnOrigin(c);
    if (!origin) return c.json({ error: "Unknown site." }, 400);
    const sub = subscriptions.get(user);
    if (isPro(sub)) return c.json({ error: "You already have Tripica Pro." }, 409);
    try {
      const url = await billing.stripe.checkout({ userId: user, plan: parsed.data.plan, customerId: sub?.customerId, trial: !sub?.trialUsed, origin });
      return c.json({ url });
    } catch (e) {
      deps.log?.("stripe checkout failed", e);
      return c.json({ error: "Couldn't start checkout. Please try again." }, 502);
    }
  });
  /** Back from Stripe Checkout: confirm the purchase directly, so Pro starts without waiting for a webhook. */
  app.post("/api/billing/sync", async (c) => {
    const user = userOf(c);
    if (!billing) return c.json({ error: "Pro is not available yet." }, 404);
    if (!user) return c.json({ error: "Sign in first.", signIn: true }, 401);
    const parsed = z.object({ sessionId: z.string().max(300) }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "Missing checkout session." }, 400);
    try {
      const u = await billing.stripe.checkoutResult(parsed.data.sessionId);
      if (!u || u.userId !== user) return c.json({ error: "That checkout belongs to another account." }, 403);
      const sub = subscriptions.apply(u);
      return c.json({ pro: isPro(sub), status: sub.status ?? null });
    } catch (e) {
      deps.log?.("stripe sync failed", e);
      return c.json({ error: "Could not confirm the purchase yet." }, 502);
    }
  });
  app.post("/api/billing/portal", async (c) => {
    const user = userOf(c);
    if (!billing) return c.json({ error: "Pro isn't available yet." }, 404);
    if (!user) return c.json({ error: "Sign in first.", signIn: true }, 401);
    const origin = returnOrigin(c);
    const customerId = subscriptions.get(user)?.customerId;
    if (!origin) return c.json({ error: "Unknown site." }, 400);
    if (!customerId) return c.json({ error: "No subscription to manage." }, 404);
    try {
      return c.json({ url: await billing.stripe.portal({ customerId, origin }) });
    } catch (e) {
      deps.log?.("stripe portal failed", e);
      return c.json({ error: "Couldn't open subscription settings. Please try again." }, 502);
    }
  });
  /** Stripe → Tripica: subscription started, renewed, changed or cancelled. Signature-checked. */
  app.post("/api/billing/webhook", async (c) => {
    if (!billing) return c.json({ error: "Not configured" }, 404);
    const payload = await c.req.text();
    if (!(await verifyStripeSignature(payload, c.req.header("stripe-signature"), billing.webhookSecret))) {
      return c.json({ error: "Bad signature" }, 400);
    }
    let event: unknown;
    try { event = JSON.parse(payload); } catch { return c.json({ error: "Bad payload" }, 400); }
    const update = subscriptionUpdate(event, billing.prices);
    if (update) subscriptions.apply(update);
    return c.json({ received: true });
  });

  /**
   * First sign-in on a browser: move the trips and watches it saved anonymously to the account,
   * so nothing is lost. Needs the browser id header and a signed-in user.
   */
  app.post("/api/account/claim", (c) => {
    const user = userOf(c);
    const browser = browserId(c);
    if (!user) return c.json({ error: "Sign in first." }, 401);
    if (!browser) return missingOwner(c);
    const owner = `user:${user}`;
    return c.json({ trips: trips.reassign(browser, owner), watches: watches.reassign(browser, owner) });
  });

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
            signInHint: signInHint(c),
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
    return c.json(await fareDetails(parsed.data, { provider: flights, cache, quota, clientId: clientKey(c), signInHint: signInHint(c) }));
  });

  /** Return flight options for a chosen round-trip fare (1 quota unit unless cached). */
  app.post("/api/fare-returns", async (c) => {
    const parsed = DetailsInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "Invalid fare" }, 400);
    const refused = await gate(c);
    if (refused) return refused;
    return c.json(await returnFlights(parsed.data, { provider: flights, cache, quota, clientId: clientKey(c), signInHint: signInHint(c) }));
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
