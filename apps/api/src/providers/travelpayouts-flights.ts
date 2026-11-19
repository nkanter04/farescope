import { fareMatchesAirlines, findAirline, type Fare, type FlightLeg } from "@farescope/shared";
import type { FlightProvider, FlightQuery, FlightResult } from "./types.ts";

/**
 * Travelpayouts (Aviasales) Data API: cached real fares from recent Aviasales searches. It's free
 * for Travelpayouts affiliates (token from your dashboard), with a rate limit of about 600 requests
 * per minute for this endpoint, and bookings through its links earn commission.
 *
 * Endpoint: GET https://api.travelpayouts.com/aviasales/v3/prices_for_dates
 * Confirmed response fields: origin, destination, origin_airport, destination_airport, price,
 * airline, flight_number, departure_at. Treated as OPTIONAL until confirmed with a live call:
 * return_at, transfers, duration / duration_to, link. Prices are cached, not live, so a route
 * nobody searched recently returns nothing.
 *
 * One call covers one origin → one destination on one date pair, so maxAirportsPerSide is 1.
 */

export interface TravelpayoutsTicket {
  origin: string;
  destination: string;
  origin_airport?: string;
  destination_airport?: string;
  price: number;
  airline?: string;
  flight_number?: string | number;
  departure_at: string;
  return_at?: string;
  transfers?: number;
  duration?: number;
  duration_to?: number;
  link?: string;
}

export interface TravelpayoutsResponse {
  success?: boolean;
  data?: TravelpayoutsTicket[];
  error?: string;
}

export function buildTravelpayoutsParams(q: FlightQuery, token: string): URLSearchParams {
  const p = new URLSearchParams({
    origin: q.origins[0],
    destination: q.destinations[0],
    departure_at: q.departDate,
    one_way: q.returnDate ? "false" : "true",
    direct: q.maxStops === 0 ? "true" : "false",
    currency: "usd",
    sorting: "price",
    unique: "false",
    limit: "30",
    token,
  });
  if (q.returnDate) p.set("return_at", q.returnDate);
  return p;
}

/** "2027-04-03T10:25:00+09:00" → "2027-04-03 10:25" (local time as given). */
const localTime = (iso: string) => iso.replace("T", " ").slice(0, 16);

/** Affiliate link to the ticket on Aviasales, with your marker so bookings are credited. */
export function ticketUrl(link: string | undefined, marker: string | undefined): string | undefined {
  if (!link?.startsWith("/")) return undefined;
  const url = `https://www.aviasales.com${link}`;
  return marker ? `${url}${url.includes("?") ? "&" : "?"}marker=${encodeURIComponent(marker)}` : url;
}

export function parseTravelpayouts(json: TravelpayoutsResponse, q: FlightQuery, marker?: string, fetchedAt = new Date().toISOString()): FlightResult {
  if (json.success === false) {
    if (/not found|no data/i.test(json.error ?? "")) return { fares: [] };
    throw new Error(json.error || "Travelpayouts request failed");
  }
  const fares: Fare[] = [];
  (json.data ?? []).forEach((t, i) => {
    if (typeof t.price !== "number" || !(t.price > 0) || typeof t.departure_at !== "string") return;
    const from = (t.origin_airport ?? t.origin).toUpperCase();
    const to = (t.destination_airport ?? t.destination).toUpperCase();
    const code = t.airline?.toUpperCase();
    const airline = findAirline(code)?.name ?? code ?? "Airline";
    const durationMin = t.duration_to ?? t.duration ?? 0;
    // Stops are only known when the API returns them; otherwise count it as unknown-direct (0).
    const stops = typeof t.transfers === "number" ? t.transfers : 0;
    const leg: FlightLeg = {
      from,
      to,
      depart: localTime(t.departure_at),
      arrive: "",
      airline,
      airlineCode: code,
      flightNumber: t.flight_number !== undefined && code ? `${code} ${t.flight_number}` : "",
      durationMin,
    };
    fares.push({
      id: `tp-${from}${to}-${q.departDate}-${q.returnDate ?? "ow"}-${i}-${t.price}`,
      provider: "travelpayouts",
      origin: from,
      destination: to,
      departDate: t.departure_at.slice(0, 10),
      returnDate: t.return_at ? t.return_at.slice(0, 10) : q.returnDate,
      price: Math.round(t.price) * q.adults,
      currency: "USD",
      airlines: [airline],
      stops,
      durationMin,
      outbound: [leg],
      bookingUrl: ticketUrl(t.link, marker),
      fetchedAt,
      cached: false,
    });
  });
  const allowed = q.airlines ?? [];
  return {
    fares: fares
      .filter((f) => (q.maxStops === null || f.stops <= q.maxStops) && fareMatchesAirlines(f, allowed))
      .sort((a, b) => a.price - b.price),
  };
}

export function createTravelpayoutsFlightProvider(opts: { token: string; marker?: string; fetchImpl?: typeof fetch }): FlightProvider {
  const f = opts.fetchImpl ?? fetch;
  return {
    name: "travelpayouts",
    live: true,
    maxAirportsPerSide: 1,
    async search(q) {
      const res = await f(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${buildTravelpayoutsParams(q, opts.token)}`, {
        headers: { "Accept-Encoding": "gzip" },
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => ({}))) as TravelpayoutsResponse;
      if (!res.ok && !json.error) throw new Error(`Travelpayouts HTTP ${res.status}`);
      return parseTravelpayouts(json, q, opts.marker);
    },
  };
}
