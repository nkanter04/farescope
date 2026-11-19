import { fareMatchesAirlines, type Cabin, type Fare } from "@farescope/shared";
import { ttlFor } from "../ttl.ts";
import { flightQueryKey, type FlightProvider, type FlightQuery, type FlightResult } from "../providers/types.ts";
import type { SearchCache, SearchQuota } from "./run.ts";

/**
 * Real itineraries for one date pair: opening a date-grid (price-only) fare calls this. Cache first;
 * a live lookup costs one quota unit. Browser-safe (the demo uses it too).
 */
export interface DetailsInput {
  fare: Fare;
  cabin: Cabin;
  maxStops: 0 | 1 | 2 | null;
  adults: number;
  airlines?: string[];
}

export interface DetailsDeps {
  provider: FlightProvider;
  cache: SearchCache;
  quota: SearchQuota;
  clientId: string;
  now?: () => Date;
}

export interface DetailsResult {
  fares: Fare[];
  cached: boolean;
  stale?: boolean;
  /** Set when nothing could be fetched (budget used up, provider error). */
  error?: string;
}

export function detailsQuery(input: DetailsInput): FlightQuery {
  const { fare } = input;
  return {
    origins: fare.coverage?.origins ?? [fare.origin],
    destinations: fare.coverage?.destinations ?? [fare.destination],
    departDate: fare.departDate,
    returnDate: fare.returnDate,
    cabin: input.cabin,
    maxStops: input.maxStops,
    adults: input.adults,
    airlines: input.airlines?.length ? input.airlines : undefined,
  };
}

export async function fareDetails(input: DetailsInput, deps: DetailsDeps): Promise<DetailsResult> {
  const now = deps.now ?? (() => new Date());
  const q = detailsQuery(input);
  const key = flightQueryKey(deps.provider.name, q);
  const shape = (fares: Fare[], flags: { cached: boolean; stale?: boolean }): Fare[] =>
    fares
      .filter((f) => (q.maxStops === null || f.stops <= q.maxStops) && fareMatchesAirlines(f, q.airlines ?? []))
      .map((f) => ({ ...f, cached: flags.cached, stale: flags.stale, queryKey: key }))
      .sort((a, b) => a.price - b.price);
  const hit = deps.cache.get<FlightResult>(key);
  if (hit && !hit.expired) return { fares: shape(hit.value.fares, { cached: true }), cached: true };
  if (deps.provider.live) {
    const decision = deps.quota.tryConsume(deps.clientId);
    if (!decision.ok) {
      if (hit) return { fares: shape(hit.value.fares, { cached: true, stale: true }), cached: true, stale: true };
      return {
        fares: [],
        cached: false,
        error: decision.reason === "monthly" ? "This month's live search budget is used up." : "You've hit today's live search limit.",
      };
    }
  }
  try {
    const result = await deps.provider.search(q);
    deps.cache.put(key, deps.provider.name, result, ttlFor(q.departDate, now()));
    if (deps.provider.live) deps.cache.recordPrices(result.fares, q.cabin);
    return { fares: shape(result.fares, { cached: false }), cached: false };
  } catch (e) {
    if (hit) return { fares: shape(hit.value.fares, { cached: true, stale: true }), cached: true, stale: true };
    return { fares: [], cached: false, error: (e as Error).message };
  }
}
