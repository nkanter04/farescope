import type { Cabin, Fare, PriceInsights, PricePoint, ReturnOption, Stay } from "@farescope/shared";

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

/**
 * One calendar call: the cheapest price for every departure date in a range, for one trip length.
 * Cheap way to cover wide date windows (Google Flights' date grid), but it has no itinerary details.
 */
export interface CalendarQuery {
  origins: string[];
  destinations: string[];
  rangeStart: string;
  rangeEnd: string;
  /** Round trip length in nights; undefined = one way. */
  nights?: number;
  cabin: Cabin;
  maxStops: 0 | 1 | 2 | null;
  adults: number;
  airlines?: string[];
}

export interface CalendarPrice {
  departDate: string;
  returnDate?: string;
  /** Total for all travelers, USD. */
  price: number;
}

/** One explore call: Google's cheapest destinations from an origin for a month and trip length. */
export interface ExploreQuery {
  /** One airport code or Google place ID. */
  origin: string;
  /** Google area ID to explore (a region); undefined = Google's default "anywhere". */
  areaId?: string;
  /** 1..12 */
  month: number;
  /** Round trip length bucket: 1 weekend, 2 about a week, 3 about two weeks; undefined = one way. */
  duration?: 1 | 2 | 3;
  cabin: Cabin;
  maxStops: 0 | 1 | 2 | null;
  adults: number;
  airlines?: string[];
}

export interface ExploreDeal {
  /** Destination airport code. */
  destination: string;
  name: string;
  country?: string;
  departDate: string;
  returnDate?: string;
  /** Total for all travelers, USD. */
  price: number;
  airline?: string;
  airlineCode?: string;
  stops?: number;
  durationMin?: number;
}

export interface FlightProvider {
  name: string;
  /** True if each call costs real quota (and must pass the quota guard). */
  live: boolean;
  /** Max airports per side the provider accepts in a single call. */
  maxAirportsPerSide: number;
  search(q: FlightQuery): Promise<FlightResult>;
  /** Optional date-grid lookup (one call prices a whole date range). */
  calendar?(q: CalendarQuery): Promise<CalendarPrice[]>;
  /** Longest range one calendar call should cover. */
  calendarMaxDays?: number;
  /** Optional: return flights for a round-trip fare that carries a `returnToken`. */
  returns?(fare: Fare, q: { cabin: Cabin; maxStops: 0 | 1 | 2 | null; adults: number }): Promise<ReturnOption[]>;
  /** Optional destination discovery ("anywhere" or a region) in one call. */
  explore?(q: ExploreQuery): Promise<ExploreDeal[]>;
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

export function calendarQueryKey(provider: string, q: CalendarQuery): string {
  const key = [
    "c",
    provider,
    [...q.origins].sort().join(","),
    [...q.destinations].sort().join(","),
    q.rangeStart,
    q.rangeEnd,
    q.nights ?? "ow",
    q.cabin,
    q.maxStops ?? "any",
    q.adults,
  ].join("|");
  return q.airlines?.length ? `${key}|al:${[...q.airlines].sort().join(",")}` : key;
}

export function exploreQueryKey(provider: string, q: ExploreQuery): string {
  const key = ["e", provider, q.origin, q.areaId ?? "any", q.month, q.duration ?? "ow", q.cabin, q.maxStops ?? "any", q.adults].join("|");
  return q.airlines?.length ? `${key}|al:${[...q.airlines].sort().join(",")}` : key;
}

export function stayQueryKey(provider: string, q: StayQuery): string {
  const key = ["s", provider, q.airport, q.checkIn, q.checkOut, q.adults].join("|");
  return q.location ? `${key}|${encodeURIComponent(q.location.trim().toLowerCase())}` : key;
}
