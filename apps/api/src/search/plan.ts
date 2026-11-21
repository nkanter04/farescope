import { addDays, daysBetween, optimizeItinerary, planLegs, planNodes, resolvePlace, todayISO, type ItineraryResult, type PlanRequest } from "@farescope/shared";
import { ttlFor } from "../ttl.ts";
import { calendarQueryKey, type CalendarPrice, type CalendarQuery, type FlightProvider } from "../providers/types.ts";
import { limitError } from "./limits.ts";
import { representativeAirport, type SearchCache, type SearchQuota } from "./run.ts";
import { routeCount } from "../providers/routes.ts";

/**
 * The multi-stop planner's data step: price every leg's possible dates with one-way date grids
 * (Google's calendar via the provider, one call per leg per 121 days), then hand the prices to the
 * pure optimizer. Cache first; live lookups for a plan are reserved from the quota all at once.
 * Browser-safe (the demo runs it in the browser with the mock provider).
 */
export interface PlanDeps {
  provider: FlightProvider;
  cache: SearchCache;
  quota: SearchQuota;
  clientId: string;
  /** Most live lookups one plan may spend. */
  maxCredits: number;
  now?: () => Date;
  signInHint?: boolean;
  signal?: AbortSignal;
}

export interface PlanResponse {
  result?: ItineraryResult;
  /** Airport used for each place (multi-airport cities use their main airport). */
  airports: Record<number, string>;
  creditsUsed: number;
  notices: string[];
  error?: string;
}

interface Chunk {
  from: number;
  to: number;
  query: CalendarQuery;
  key: string;
}

export async function planTrip(req: PlanRequest, deps: PlanDeps): Promise<PlanResponse> {
  const now = deps.now?.() ?? new Date();
  const today = todayISO(now);
  const { provider } = deps;
  const notices: string[] = [];

  // Each place prices from one airport (the calendar takes one per side).
  const airports: Record<number, string> = {};
  for (const node of planNodes(req)) {
    const place = resolvePlace(node.place);
    if (!place?.airports.length) return { airports, creditsUsed: 0, notices, error: `We couldn't find "${node.place}". Pick a city or airport from the list.` };
    airports[node.id] = mainAirport(place.airports);
  }
  if (provider.live && !provider.calendar) {
    return { airports, creditsUsed: 0, notices, error: "Trip planning needs date-grid prices, which this data source doesn't offer." };
  }

  // One grid lookup per flown leg per range chunk.
  const maxDays = provider.calendarMaxDays ?? 121;
  const chunks: Chunk[] = [];
  for (const leg of planLegs(req, today)) {
    for (let start = leg.dateFrom; start <= leg.dateTo; start = addDays(start, maxDays)) {
      const endDay = addDays(start, maxDays - 1);
      const query: CalendarQuery = {
        origins: [airports[leg.from]], destinations: [airports[leg.to]], rangeStart: start, rangeEnd: endDay < leg.dateTo ? endDay : leg.dateTo,
        cabin: req.cabin, maxStops: req.maxStops, adults: req.adults,
      };
      chunks.push({ from: leg.from, to: leg.to, query, key: calendarQueryKey(provider.name, query) });
    }
  }

  const fresh = new Map<string, CalendarPrice[]>();
  const stale = new Map<string, CalendarPrice[]>();
  for (const c of chunks) {
    const hit = deps.cache.get<CalendarPrice[]>(c.key);
    if (hit) (hit.expired ? stale : fresh).set(c.key, hit.value);
  }
  const toFetch = chunks.filter((c) => !fresh.has(c.key));
  let creditsUsed = 0;
  let fetchList = toFetch;
  if (provider.live && toFetch.length) {
    if (toFetch.length > deps.maxCredits) {
      return { airports, creditsUsed: 0, notices, error: `This plan needs ${toFetch.length} credits, more than the ${deps.maxCredits} one plan can use. Remove a stop, narrow the dates, or turn off "Try other orders".` };
    }
    // Reserve every credit the plan needs at once, so it never stops half-priced.
    const decision = deps.quota.tryConsume(deps.clientId, toFetch.length);
    if (!decision.ok) {
      if (!stale.size) return { airports, creditsUsed: 0, notices, error: `${limitError(decision.reason, { signInHint: deps.signInHint })} This plan needs ${toFetch.length} credits.` };
      notices.push("Some prices are from earlier searches because you're out of live searches.");
      fetchList = [];
    } else {
      creditsUsed = toFetch.length;
    }
  }

  const fetched = new Map<string, CalendarPrice[]>();
  let i = 0;
  const worker = async () => {
    while (i < fetchList.length && !deps.signal?.aborted) {
      const c = fetchList[i++];
      try {
        const prices = provider.calendar ? await provider.calendar(c.query) : await mockGrid(provider, c.query);
        fetched.set(c.key, prices);
        deps.cache.put(c.key, provider.name, prices, ttlFor(c.query.rangeStart, now));
      } catch (e) {
        notices.push(`Couldn't price ${c.query.origins[0]} → ${c.query.destinations[0]}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, fetchList.length) }, worker));

  // Lowest price per leg per date (fresh, just fetched, then expired cache as a fallback).
  const byLeg = new Map<string, Map<string, number>>();
  for (const c of chunks) {
    const prices = fetched.get(c.key) ?? fresh.get(c.key) ?? stale.get(c.key) ?? [];
    const legKey = `${c.from}>${c.to}`;
    const m = byLeg.get(legKey) ?? new Map<string, number>();
    for (const p of prices) if (!m.has(p.departDate) || p.price < m.get(p.departDate)!) m.set(p.departDate, p.price);
    byLeg.set(legKey, m);
  }
  const result = optimizeItinerary(req, (from, to, date) => byLeg.get(`${from}>${to}`)?.get(date));
  if (!result.best) notices.push("No combination of dates had prices for every flight. Try a wider start window or more flexible nights.");
  return { result, airports, creditsUsed, notices };
}

/** A place's main airport: the one with the most routes (Kansai over Itami, Narita over Haneda). */
export function mainAirport(airports: string[]): string {
  if (airports.length === 1) return airports[0];
  const ranked = [...airports].sort((a, b) => routeCount(b) - routeCount(a));
  return routeCount(ranked[0]) > 0 ? ranked[0] : representativeAirport(airports);
}

/** Free providers without a calendar (the demo's mock): one one-way search per date, lowest price. */
async function mockGrid(provider: FlightProvider, q: CalendarQuery): Promise<CalendarPrice[]> {
  const out: CalendarPrice[] = [];
  for (let d = q.rangeStart, k = 0; d <= q.rangeEnd && k <= daysBetween(q.rangeStart, q.rangeEnd); d = addDays(d, 1), k++) {
    const { fares } = await provider.search({ origins: q.origins, destinations: q.destinations, departDate: d, cabin: q.cabin, maxStops: q.maxStops, adults: q.adults });
    const min = fares.reduce((m, f) => Math.min(m, f.price), Infinity);
    if (Number.isFinite(min)) out.push({ departDate: d, price: min });
  }
  return out;
}
