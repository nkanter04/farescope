import { AIRPORT_BY_IATA, COUNTRIES, daysBetween, type Stay, type StayKind } from "@farescope/shared";
import type { StayProvider, StayQuery } from "./types.ts";

/**
 * SerpApi "google_hotels" engine. Hotels and hostels come from the normal search; vacation rentals
 * (which include many Airbnb/Vrbo-style listings Google indexes) need `vacation_rentals=true`,
 * so a full lodging search is two calls. Docs: https://serpapi.com/google-hotels-api
 */

interface SerpProperty {
  type?: string;
  name: string;
  link?: string;
  property_token?: string;
  gps_coordinates?: { latitude: number; longitude: number };
  rate_per_night?: { extracted_lowest?: number };
  total_rate?: { extracted_lowest?: number };
  overall_rating?: number;
  reviews?: number;
  extracted_hotel_class?: number;
  images?: { thumbnail?: string }[];
  amenities?: string[];
}
export interface SerpHotelsResponse {
  error?: string;
  properties?: SerpProperty[];
}

export function buildHotelParams(q: StayQuery, apiKey: string, rentals: boolean): URLSearchParams {
  const ap = AIRPORT_BY_IATA[q.airport];
  const where = ap ? `${ap.city}, ${COUNTRIES[ap.country]?.name ?? ap.country}` : q.airport;
  const p = new URLSearchParams({
    engine: "google_hotels",
    q: rentals ? where : `${where} hotels and hostels`,
    check_in_date: q.checkIn,
    check_out_date: q.checkOut,
    adults: String(q.adults),
    currency: "USD",
    hl: "en",
    gl: "us",
    api_key: apiKey,
  });
  if (rentals) p.set("vacation_rentals", "true");
  return p;
}

function kindOf(p: SerpProperty, rentals: boolean): StayKind {
  if (rentals || /vacation rental/i.test(p.type ?? "")) return "rental";
  if (/hostel/i.test(p.name) || /hostel/i.test(p.type ?? "")) return "hostel";
  return "hotel";
}

export function parseHotels(json: SerpHotelsResponse, q: StayQuery, rentals: boolean): Stay[] {
  if (json.error) {
    if (/hasn't returned any results|no results/i.test(json.error)) return [];
    throw new Error(json.error);
  }
  const nights = Math.max(1, daysBetween(q.checkIn, q.checkOut));
  const out: Stay[] = [];
  (json.properties ?? []).forEach((p, i) => {
    const nightly = p.rate_per_night?.extracted_lowest;
    if (typeof nightly !== "number" || !p.gps_coordinates) return;
    out.push({
      id: `serpstay-${p.property_token ?? `${q.airport}-${rentals ? "r" : "h"}-${i}`}`,
      provider: "serpapi",
      name: p.name,
      kind: kindOf(p, rentals),
      lat: p.gps_coordinates.latitude,
      lng: p.gps_coordinates.longitude,
      nightly,
      total: p.total_rate?.extracted_lowest ?? nightly * nights,
      rating: p.overall_rating,
      reviews: p.reviews,
      stars: p.extracted_hotel_class,
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      url: p.link,
      image: p.images?.[0]?.thumbnail,
      amenities: (p.amenities ?? []).slice(0, 6),
    });
  });
  return out;
}

export function createSerpApiStayProvider(opts: { apiKey: string; fetchImpl?: typeof fetch; includeRentals?: boolean }): StayProvider {
  const f = opts.fetchImpl ?? fetch;
  const call = async (q: StayQuery, rentals: boolean) => {
    const res = await f(`https://serpapi.com/search.json?${buildHotelParams(q, opts.apiKey, rentals)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as SerpHotelsResponse;
    if (!res.ok && !json.error) throw new Error(`SerpApi HTTP ${res.status}`);
    return parseHotels(json, q, rentals);
  };
  return {
    name: "serpapi",
    live: true,
    callsPerSearch: opts.includeRentals ? 2 : 1,
    async search(q) {
      const parts = await Promise.all([call(q, false), opts.includeRentals ? call(q, true) : Promise.resolve([])]);
      return parts.flat().sort((a, b) => a.total - b.total);
    },
  };
}
