import type { Cabin, Fare, PriceInsights, PricePoint, Stay } from "@farescope/shared";

/** One provider call: a set of origin airports x a set of destination airports on one date pair. */
export interface FlightQuery {
  origins: string[];
  destinations: string[];
  departDate: string;
  returnDate?: string;
  cabin: Cabin;
  maxStops: 0 | 1 | 2 | null;
  adults: number;
  /** Only itineraries flown entirely by these airlines (IATA codes); empty/undefined = any. */
  airlines?: string[];
}

export interface FlightResult {
  fares: Fare[];
  insights?: PriceInsights;
}

export interface FlightProvider {
  name: string;
  /** True if each call costs real quota (and must pass the quota guard). */
  live: boolean;
  /** Max airports per side the provider accepts in a single call. */
  maxAirportsPerSide: number;
  search(q: FlightQuery): Promise<FlightResult>;
  /**
   * Optional per-fare price history. The mock simulates it; live providers instead get history
   * from the cached search response (Google's price_history) and the price_history table.
   */
  priceHistory?(fare: Fare): PricePoint[];
}

export interface StayQuery {
  /** Destination airport; the provider searches around its city. */
  airport: string;
  location?: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}

export interface StayProvider {
  name: string;
  live: boolean;
  /** Live provider calls (quota units) one search spends. */
  callsPerSearch: number;
  search(q: StayQuery): Promise<Stay[]>;
}

export function flightQueryKey(provider: string, q: FlightQuery): string {
  const key = [
    "f",
    // Retire cached synthetic nonstops from the previous mock generator.
    provider === "mock" ? "mock-routes-v4" : provider,
    [...q.origins].sort().join(","),
    [...q.destinations].sort().join(","),
    q.departDate,
    q.returnDate ?? "-",
    q.cabin,
    q.maxStops ?? "any",
    q.adults,
  ].join("|");
  // Airline-filtered searches are different provider calls; unfiltered keys stay unchanged.
  return q.airlines?.length ? `${key}|al:${[...q.airlines].sort().join(",")}` : key;
}

export function stayQueryKey(provider: string, q: StayQuery): string {
  const key = ["s", provider, q.airport, q.checkIn, q.checkOut, q.adults].join("|");
  return q.location ? `${key}|${encodeURIComponent(q.location.trim().toLowerCase())}` : key;
}
