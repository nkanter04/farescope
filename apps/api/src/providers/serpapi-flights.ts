import { codeFromFlightNumber, fareMatchesAirlines, type Cabin, type Fare, type FlightLeg, type PriceInsights, type PricePoint, type ReturnOption } from "@farescope/shared";
import type { CalendarPrice, CalendarQuery, ExploreDeal, ExploreQuery, FlightProvider, FlightQuery, FlightResult } from "./types.ts";

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
  airline_logo?: string;
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
  // Let Google filter airlines so no quota is spent on itineraries the user doesn't want.
  if (q.airlines?.length) p.set("include_airlines", q.airlines.join(","));
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
      airlineCode: codeFromFlightNumber(s.flight_number),
      airlineLogo: s.airline_logo?.startsWith("https://") ? s.airline_logo : undefined,
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
      returnToken: q.returnDate && it.departure_token ? it.departure_token : undefined,
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
  const allowed = q.airlines ?? [];
  return { fares: fares.filter((f) => fareMatchesAirlines(f, allowed)).sort((a, b) => a.price - b.price), insights };
}

/**
 * SerpApi "google_flights_calendar" engine: Google Flights' date grid. One call returns the cheapest
 * price for each departure date in [date_range_start, date_range_end] at one trip length, for a
 * comma-separated set of airports per side. It has no itinerary details (airlines, stops, times).
 * Docs: https://serpapi.com/google-flights-calendar-api
 */
export interface SerpCalendarResponse {
  error?: string;
  search_metadata?: { status?: string };
  prices?: { outbound_date?: string; return_date?: string; price?: number; low_price?: boolean }[];
}

export function buildCalendarParams(q: CalendarQuery, apiKey: string): URLSearchParams {
  const p = new URLSearchParams({
    engine: "google_flights_calendar",
    departure_id: q.origins.join(","),
    arrival_id: q.destinations.join(","),
    date_range_start: q.rangeStart,
    date_range_end: q.rangeEnd,
    type: q.nights === undefined ? "2" : "1",
    travel_class: String(TRAVEL_CLASS[q.cabin]),
    stops: String(STOPS(q.maxStops)),
    adults: String(q.adults),
    currency: "USD",
    hl: "en",
    gl: "us",
    api_key: apiKey,
  });
  if (q.nights !== undefined) p.set("round_trip_days", String(q.nights));
  if (q.airlines?.length) p.set("include_airlines", q.airlines.join(","));
  return p;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseCalendar(json: SerpCalendarResponse, q: CalendarQuery): CalendarPrice[] {
  if (json.error) {
    if (/hasn't returned any results|no results/i.test(json.error)) return [];
    throw new Error(json.error);
  }
  const out: CalendarPrice[] = [];
  for (const row of json.prices ?? []) {
    if (typeof row.price !== "number" || !(row.price > 0) || !row.outbound_date || !ISO_DAY.test(row.outbound_date)) continue;
    if (row.outbound_date < q.rangeStart || row.outbound_date > q.rangeEnd) continue;
    const ret = row.return_date && ISO_DAY.test(row.return_date) ? row.return_date : undefined;
    if (q.nights !== undefined && !ret) continue;
    out.push({ departDate: row.outbound_date, returnDate: q.nights === undefined ? undefined : ret, price: Math.round(row.price) });
  }
  return out.sort((a, b) => a.departDate.localeCompare(b.departDate));
}

/**
 * SerpApi "google_travel_explore" engine: Google's Explore map. One call returns destinations from
 * an origin for a month and trip-length bucket, each with Google's lowest flight price and dates.
 * About 40% of entries come without a price or airport (Google shows them unpriced); those are skipped.
 * Docs: https://serpapi.com/google-travel-explore-api
 */
export interface SerpExploreResponse {
  error?: string;
  destinations?: {
    name?: string;
    country?: string;
    destination_airport?: { code?: string };
    start_date?: string;
    end_date?: string;
    flight_price?: number;
    flight_duration?: number;
    number_of_stops?: number;
    airline?: string;
    airline_code?: string;
  }[];
}

export function buildExploreParams(q: ExploreQuery, apiKey: string): URLSearchParams {
  const p = new URLSearchParams({
    engine: "google_travel_explore",
    departure_id: q.origin,
    month: String(q.month),
    type: q.duration === undefined ? "2" : "1",
    travel_class: String(TRAVEL_CLASS[q.cabin]),
    stops: String(STOPS(q.maxStops)),
    adults: String(q.adults),
    currency: "USD",
    hl: "en",
    gl: "us",
    api_key: apiKey,
  });
  if (q.duration !== undefined) p.set("travel_duration", String(q.duration));
  if (q.areaId) p.set("arrival_area_id", q.areaId);
  if (q.airlines?.length) p.set("include_airlines", q.airlines.join(","));
  return p;
}

export function parseExplore(json: SerpExploreResponse, q: ExploreQuery): ExploreDeal[] {
  if (json.error) {
    if (/hasn't returned any results|no results/i.test(json.error)) return [];
    throw new Error(json.error);
  }
  const out: ExploreDeal[] = [];
  for (const d of json.destinations ?? []) {
    const code = d.destination_airport?.code;
    if (!code || !/^[A-Z]{3}$/.test(code) || typeof d.flight_price !== "number" || !(d.flight_price > 0)) continue;
    if (!d.start_date || !ISO_DAY.test(d.start_date)) continue;
    const ret = d.end_date && ISO_DAY.test(d.end_date) ? d.end_date : undefined;
    if (q.duration !== undefined && !ret) continue;
    out.push({
      destination: code,
      name: d.name ?? code,
      country: d.country,
      departDate: d.start_date,
      returnDate: q.duration === undefined ? undefined : ret,
      price: Math.round(d.flight_price),
      airline: d.airline,
      airlineCode: d.airline_code && /^[A-Z0-9]{2}$/.test(d.airline_code) ? d.airline_code : undefined,
      stops: typeof d.number_of_stops === "number" ? d.number_of_stops : undefined,
      durationMin: typeof d.flight_duration === "number" ? d.flight_duration : undefined,
    });
  }
  return out.sort((a, b) => a.price - b.price);
}

/**
 * Return flights for one outbound flight: the same search plus its departure_token. Each option's
 * price is the round-trip total with that return.
 */
export function parseReturns(json: SerpFlightsResponse): ReturnOption[] {
  if (json.error) {
    if (/hasn't returned any results|no results/i.test(json.error)) return [];
    throw new Error(json.error);
  }
  return [...(json.best_flights ?? []), ...(json.other_flights ?? [])]
    .filter((it) => typeof it.price === "number" && it.flights?.length)
    .map((it) => {
      const legs = it.flights.map((s): FlightLeg => ({
        from: s.departure_airport.id,
        to: s.arrival_airport.id,
        depart: s.departure_airport.time ?? "",
        arrive: s.arrival_airport.time ?? "",
        airline: s.airline ?? "",
        flightNumber: s.flight_number ?? "",
        airlineCode: codeFromFlightNumber(s.flight_number),
        airlineLogo: s.airline_logo?.startsWith("https://") ? s.airline_logo : undefined,
        durationMin: s.duration ?? 0,
      }));
      return {
        legs,
        airlines: [...new Set(legs.map((l) => l.airline).filter(Boolean))],
        stops: legs.length - 1,
        durationMin: it.total_duration ?? legs.reduce((s, l) => s + l.durationMin, 0),
        price: it.price as number,
      };
    })
    .sort((a, b) => a.price - b.price);
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
    // A live call on 2026-11-19 returned all 121 days of a 121-day range; longer ranges are split.
    calendarMaxDays: 121,
    async returns(fare, q) {
      if (!fare.returnToken || !fare.returnDate) return [];
      const params = buildFlightParams({
        origins: [fare.origin], destinations: [fare.destination], departDate: fare.departDate, returnDate: fare.returnDate,
        cabin: q.cabin, maxStops: q.maxStops, adults: q.adults,
      }, opts.apiKey);
      params.set("departure_token", fare.returnToken);
      const res = await f(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      const json = (await res.json()) as SerpFlightsResponse;
      if (!res.ok && !json.error) throw new Error(`SerpApi HTTP ${res.status}`);
      return parseReturns(json);
    },
    async explore(q) {
      const url = `https://serpapi.com/search.json?${buildExploreParams(q, opts.apiKey)}`;
      const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      const json = (await res.json()) as SerpExploreResponse;
      if (!res.ok && !json.error) throw new Error(`SerpApi HTTP ${res.status}`);
      return parseExplore(json, q);
    },
    async calendar(q) {
      const url = `https://serpapi.com/search.json?${buildCalendarParams(q, opts.apiKey)}`;
      const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      const json = (await res.json()) as SerpCalendarResponse;
      if (!res.ok && !json.error) throw new Error(`SerpApi HTTP ${res.status}`);
      return parseCalendar(json, q);
    },
  };
}
