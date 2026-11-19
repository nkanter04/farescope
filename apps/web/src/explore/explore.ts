import { addDays, AIRPORT_BY_IATA, COUNTRIES, type Fare, type SearchRequest } from "@farescope/shared";
import monthIndex from "./month-index.json";

/** Airlines publish about 11 months out; the app caps dates at today + 330 days. */
export const MAX_AHEAD_DAYS = 330;

export interface ExploreMonth {
  /** "YYYY-MM" */
  key: string;
  month: number;
  year: number;
  departFrom: string;
  departTo: string;
}

/** The next `count` calendar months that still have bookable departures, starting with this one. */
export function exploreMonths(today: string, count = 6): ExploreMonth[] {
  const last = addDays(today, MAX_AHEAD_DAYS);
  const out: ExploreMonth[] = [];
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  while (out.length < count) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const first = `${key}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end = addDays(next, -1);
    // Leave a week so this month still has departures worth searching.
    const from = first < addDays(today, 7) ? addDays(today, 7) : first;
    const to = end > last ? last : end;
    if (from > last) break;
    if (from <= to) out.push({ key, month, year, departFrom: from, departTo: to });
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
  return out;
}

/** An "anywhere" round-trip search for one month, from one origin. */
export function exploreRequest(origin: string, m: ExploreMonth, adults: number): SearchRequest {
  return {
    origins: [origin],
    destinations: ["anywhere"],
    departFrom: m.departFrom,
    departTo: m.departTo,
    tripType: "roundtrip",
    minNights: 5,
    maxNights: 9,
    cabin: "economy",
    maxStops: null,
    adults,
    airlines: [],
  };
}

export interface ExploreDeal {
  /** City search token, e.g. "city:Tokyo|JP". */
  token: string;
  city: string;
  country: string;
  countryName: string;
  fare: Fare;
}

/**
 * The cheapest fare per destination city, cheapest first. Fares to the origin's own city are skipped,
 * and with `abroadFrom` (a country code) so are domestic ones.
 */
export function cheapestByCity(fares: Fare[], limit = 12, abroadFrom?: string): ExploreDeal[] {
  const best = new Map<string, ExploreDeal>();
  for (const fare of fares) {
    const to = AIRPORT_BY_IATA[fare.destination];
    if (!to || (abroadFrom && to.country === abroadFrom)) continue;
    const from = AIRPORT_BY_IATA[fare.origin];
    if (from && from.city === to.city && from.country === to.country) continue;
    const token = `city:${to.city}|${to.country}`;
    const prev = best.get(token);
    if (!prev || fare.price < prev.fare.price) {
      best.set(token, { token, city: to.city, country: to.country, countryName: COUNTRIES[to.country]?.name ?? to.country, fare });
    }
  }
  return [...best.values()].sort((a, b) => a.fare.price - b.fare.price).slice(0, limit);
}

type MonthIndex = Record<string, { name: string; labels: string[]; best: number[] }>;
export const MONTH_INDEX = monthIndex as MonthIndex;
