import { todayISO, type Fare, type PriceWatch } from "@farescope/shared";
import { flightQueryKey, type FlightProvider, type FlightQuery, type FlightResult } from "../providers/types.ts";
import { ttlFor } from "../ttl.ts";
import type { SearchCache, SearchQuota } from "./run.ts";

/** Re-checking a watch at most this often keeps live quota use to a few calls a day. */
export const WATCH_RECHECK_MS = 6 * 3_600_000;
export const MAX_WATCHES = 10;
const MAX_CHECKS = 30;

export interface WatchDeps {
  provider: FlightProvider;
  cache: SearchCache;
  quota: SearchQuota;
  clientId: string;
  now?: () => Date;
  /** Ignore the recheck interval (used right after creating a watch in tests). */
  force?: boolean;
}

export function watchQuery(w: Pick<PriceWatch, "fare" | "cabin" | "adults">): FlightQuery {
  return {
    origins: [w.fare.origin],
    destinations: [w.fare.destination],
    departDate: w.fare.departDate,
    returnDate: w.fare.returnDate,
    cabin: w.cabin,
    maxStops: null,
    adults: w.adults,
  };
}

const path = (f: Fare) => f.outbound.map((l) => `${l.from}>${l.to}`).join(",");

/** The same flight if it's still offered, else the cheapest with the same stops, else the cheapest. */
export function matchFare(target: Fare, fares: Fare[]): Fare | undefined {
  const byPrice = [...fares].sort((a, b) => a.price - b.price);
  return (
    byPrice.find((f) => path(f) === path(target) && f.airlines.join() === target.airlines.join()) ??
    byPrice.find((f) => f.stops === target.stops) ??
    byPrice[0]
  );
}

export interface WatchCheck {
  watch: PriceWatch;
  /** Live provider calls spent (0 for cache hits and the mock). */
  units: number;
  checked: boolean;
}

/**
 * Re-price one watched flight. Cache-first; a live call goes through the quota guard, and if the
 * budget is gone the watch is left unchanged until the next check.
 */
export async function checkWatch(watch: PriceWatch, deps: WatchDeps): Promise<WatchCheck> {
  const now = deps.now?.() ?? new Date();
  const today = todayISO(now);
  if (watch.fare.departDate < today) return { watch: { ...watch, status: "departed" }, units: 0, checked: false };
  if (!deps.force && now.getTime() - Date.parse(watch.lastChecked) < WATCH_RECHECK_MS) return { watch, units: 0, checked: false };

  const query = watchQuery(watch);
  const key = flightQueryKey(deps.provider.name, query);
  const hit = deps.cache.get<FlightResult>(key);
  let result: FlightResult | undefined = hit && !hit.expired ? hit.value : undefined;
  let units = 0;
  if (!result) {
    if (deps.provider.live) {
      if (!deps.quota.tryConsume(deps.clientId, 1).ok) return { watch, units: 0, checked: false };
      units = 1;
    }
    try {
      result = await deps.provider.search(query);
      deps.cache.put(key, deps.provider.name, result, ttlFor(query.departDate, now));
      if (deps.provider.live) deps.cache.recordPrices(result.fares, query.cabin);
    } catch {
      return { watch, units, checked: false };
    }
  }
  const match = matchFare(watch.fare, result.fares);
  if (!match) return { watch: { ...watch, status: "unavailable", lastChecked: now.toISOString() }, units, checked: true };
  const checks = [...watch.checks.filter((c) => c.date !== today), { date: today, price: match.price }].slice(-MAX_CHECKS);
  return {
    watch: { ...watch, status: "active", lastPrice: match.price, lastChecked: now.toISOString(), checks },
    units,
    checked: true,
  };
}

export function newWatch(fare: Fare, cabin: PriceWatch["cabin"], adults: number, id: string, now = new Date()): PriceWatch {
  return {
    id,
    fare,
    cabin,
    adults,
    priceAtWatch: fare.price,
    lastPrice: fare.price,
    lastChecked: now.toISOString(),
    checks: [{ date: todayISO(now), price: fare.price }],
    createdAt: now.toISOString(),
    status: "active",
  };
}
