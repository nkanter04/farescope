import type { Cabin, Fare, PriceInsights, Stay } from "@farescope/shared";

/** One provider call: a set of origin airports x a set of destination airports on one date pair. */
export interface FlightQuery {
  origins: string[];
  destinations: string[];
  departDate: string;
  returnDate?: string;
  cabin: Cabin;
  maxStops: 0 | 1 | 2 | null;
  adults: number;
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
}

export interface StayQuery {
  /** Destination airport; the provider searches around its city. */
  airport: string;
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
  return [
    "f",
    provider,
    [...q.origins].sort().join(","),
    [...q.destinations].sort().join(","),
    q.departDate,
    q.returnDate ?? "-",
    q.cabin,
    q.maxStops ?? "any",
    q.adults,
  ].join("|");
}

export function stayQueryKey(provider: string, q: StayQuery): string {
  return ["s", provider, q.airport, q.checkIn, q.checkOut, q.adults].join("|");
}
