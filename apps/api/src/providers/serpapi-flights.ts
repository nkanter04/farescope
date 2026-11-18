import type { Cabin, Fare, FlightLeg, PriceInsights, PricePoint } from "@farescope/shared";
import type { FlightProvider, FlightQuery, FlightResult } from "./types.ts";

/**
 * SerpApi "google_flights" engine. One call = a comma-separated set of departure airports x a set
 * of arrival airports on one date pair. Round-trip prices are the full round-trip total; the return
 * legs need a second call (departure_token), which we skip to save quota.
 * Docs: https://serpapi.com/google-flights-api
 */

const TRAVEL_CLASS: Record<Cabin, number> = { economy: 1, premium: 2, business: 3, first: 4 };
// SerpApi `stops`: 0 any, 1 nonstop only, 2 one stop or fewer, 3 two stops or fewer
const STOPS = (s: 0 | 1 | 2 | null) => (s === null ? 0 : s + 1);

interface SerpAirport { id: string; name?: string; time?: string }
interface SerpFlightSegment {
  departure_airport: SerpAirport;
  arrival_airport: SerpAirport;
  duration?: number;
  airline?: string;
  flight_number?: string;
}
interface SerpItinerary {
  flights: SerpFlightSegment[];
  total_duration?: number;
  price?: number;
  departure_token?: string;
  booking_token?: string;
}
export interface SerpFlightsResponse {
  error?: string;
  search_metadata?: { google_flights_url?: string; status?: string };
  best_flights?: SerpItinerary[];
  other_flights?: SerpItinerary[];
  price_insights?: {
    lowest_price?: number;
    price_level?: string;
    typical_price_range?: [number, number];
    /** [unix seconds, price] pairs: the search's lowest price per day over recent weeks. */
    price_history?: [number, number][];
  };
}

export function buildFlightParams(q: FlightQuery, apiKey: string): URLSearchParams {
  const p = new URLSearchParams({
    engine: "google_flights",
    departure_id: q.origins.join(","),
    arrival_id: q.destinations.join(","),
    outbound_date: q.departDate,
    type: q.returnDate ? "1" : "2",
    travel_class: String(TRAVEL_CLASS[q.cabin]),
    stops: String(STOPS(q.maxStops)),
    adults: String(q.adults),
    currency: "USD",
    hl: "en",
    gl: "us",
    api_key: apiKey,
  });
  if (q.returnDate) p.set("return_date", q.returnDate);
  return p;
}

export function parseFlights(json: SerpFlightsResponse, q: FlightQuery, fetchedAt = new Date().toISOString()): FlightResult {
  if (json.error) {
    // SerpApi returns an "error" with no results for empty routes; treat that as no fares.
    if (/hasn't returned any results|no results/i.test(json.error)) return { fares: [] };
    throw new Error(json.error);
  }
  const itineraries = [...(json.best_flights ?? []), ...(json.other_flights ?? [])];
  const fares: Fare[] = [];
  itineraries.forEach((it, i) => {
    if (typeof it.price !== "number" || !it.flights?.length) return;
    if (q.maxStops !== null && it.flights.length - 1 > q.maxStops) return;
    const first = it.flights[0];
    const last = it.flights[it.flights.length - 1];
    const legs: FlightLeg[] = it.flights.map((s) => ({
      from: s.departure_airport.id,
      to: s.arrival_airport.id,
      depart: s.departure_airport.time ?? "",
      arrive: s.arrival_airport.time ?? "",
      airline: s.airline ?? "",
      flightNumber: s.flight_number ?? "",
      durationMin: s.duration ?? 0,
    }));
    const airlines = [...new Set(legs.map((l) => l.airline).filter(Boolean))];
    fares.push({
      id: `serp-${first.departure_airport.id}${last.arrival_airport.id}-${q.departDate}-${q.returnDate ?? "ow"}-${i}-${it.price}`,
      provider: "serpapi",
      origin: first.departure_airport.id,
      destination: last.arrival_airport.id,
      departDate: q.departDate,
      returnDate: q.returnDate,
      price: it.price,
      currency: "USD",
      airlines,
      stops: it.flights.length - 1,
      durationMin: it.total_duration ?? legs.reduce((s, l) => s + l.durationMin, 0),
      outbound: legs,
      bookingUrl: json.search_metadata?.google_flights_url,
      fetchedAt,
      cached: false,
    });
  });
  const pi = json.price_insights;
  const level = pi?.price_level?.toLowerCase();
  const insights: PriceInsights | undefined = pi
    ? {
        lowestPrice: pi.lowest_price,
        typicalRange: pi.typical_price_range,
        priceLevel: level === "low" || level === "typical" || level === "high" ? level : undefined,
        history: parsePriceHistory(pi.price_history),
      }
    : undefined;
  return { fares: fares.sort((a, b) => a.price - b.price), insights };
}

/** Google's price history: free with every search, so it costs no extra quota. */
export function parsePriceHistory(raw: unknown): PricePoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byDay = new Map<string, number>();
  for (const row of raw) {
    if (!Array.isArray(row) || typeof row[0] !== "number" || typeof row[1] !== "number" || !(row[1] > 0)) continue;
    const date = new Date(row[0] * 1000).toISOString().slice(0, 10);
    byDay.set(date, Math.min(byDay.get(date) ?? Infinity, row[1]));
  }
  const points = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, price]) => ({ date, price }));
  return points.length ? points : undefined;
}

export function createSerpApiFlightProvider(opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): FlightProvider {
  const f = opts.fetchImpl ?? fetch;
  return {
    name: "serpapi",
    live: true,
    // Google Flights accepts several airports per side; 7 keeps URLs and result sets reasonable.
    maxAirportsPerSide: 7,
    async search(q) {
      const url = `https://serpapi.com/search.json?${buildFlightParams(q, opts.apiKey)}`;
      const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      const json = (await res.json()) as SerpFlightsResponse;
      if (!res.ok && !json.error) throw new Error(`SerpApi HTTP ${res.status}`);
      return parseFlights(json, q);
    },
  };
}
