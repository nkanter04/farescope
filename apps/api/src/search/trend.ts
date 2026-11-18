import {
  forecastFare,
  learnBookingCurve,
  todayISO,
  type CurveSeries,
  type Fare,
  type PricePoint,
  type PriceTrend,
} from "@farescope/shared";
import type { FlightProvider, FlightResult } from "../providers/types.ts";
import type { SearchCache } from "./run.ts";

/**
 * Builds the price trend and prediction for one fare. Browser-safe: the API server and the static
 * demo both use it, with different history sources.
 */
export interface TrendDeps {
  provider: FlightProvider;
  cache: SearchCache;
  /** Server only: this route's own past prices from the price_history table. */
  storedHistory?: (fare: Fare) => PricePoint[];
  /** Server only: previous flights' price series from the price_history table. */
  storedSeries?: () => CurveSeries[];
  now?: () => Date;
}

const MAX_PEERS = 60;

/** Past prices for this fare, oldest first, one per day. */
export function fareHistory(fare: Fare, deps: TrendDeps): PricePoint[] {
  if (deps.provider.priceHistory) return deps.provider.priceHistory(fare);
  const byDay = new Map<string, number>();
  const add = (points: PricePoint[] | undefined) => {
    for (const p of points ?? []) byDay.set(p.date, Math.min(byDay.get(p.date) ?? Infinity, p.price));
  };
  // Google's history covers the whole search (it can span several airports), so keep its shape
  // but scale it to this fare's own price level using its most recent day.
  const google = fare.queryKey ? deps.cache.get<FlightResult>(fare.queryKey)?.value.insights?.history : undefined;
  if (google?.length) {
    const scale = fare.price / google[google.length - 1].price;
    add(google.map((p) => ({ date: p.date, price: Math.round(p.price * scale) })));
  }
  add(deps.storedHistory?.(fare));
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, price]) => ({ date, price }));
}

const flightKey = (f: Fare) => `${f.origin}${f.destination}${f.departDate}${f.returnDate ?? ""}`;

/**
 * Forecast this fare. The booking curve is learned from *other* flights: peers from the same
 * search plus (on the server) every route in price_history. This flight's own history then sets
 * its price level.
 */
export function buildPriceTrend(fare: Fare, peers: Fare[], deps: TrendDeps): PriceTrend {
  const today = todayISO(deps.now?.() ?? new Date());
  const series: CurveSeries[] = [...(deps.storedSeries?.() ?? [])];
  const seen = new Set([flightKey(fare)]);
  for (const peer of peers) {
    if (series.length >= MAX_PEERS + 500 || seen.has(flightKey(peer))) continue;
    seen.add(flightKey(peer));
    const points = fareHistory(peer, deps);
    if (points.length >= 2) series.push({ departDate: peer.departDate, points: [...points, { date: today, price: peer.price }] });
  }
  return forecastFare({
    price: fare.price,
    today,
    departDate: fare.departDate,
    history: fareHistory(fare, deps),
    curve: learnBookingCurve(series),
    simulated: !deps.provider.live,
  });
}
