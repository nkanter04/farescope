import { AIRPORT_BY_IATA, addDays, daysBetween, resolvePlace } from "@farescope/shared";

/**
 * Example searches for the homepage animation, built at build time from the real place data: each
 * scene's airports, date window and the number of trips one search compares (origin airports ×
 * destination airports × departure days × trip lengths, capped like the real search). Which routes
 * glow as "cheaper" is illustrative only; the page says so and shows no prices.
 */
export interface ScenePoint { name: string; lon: number; lat: number; cheap?: boolean }
export interface HomeScene {
  /** "Austin → anywhere in Japan" */
  route: string;
  /** "Jan–Apr · 7–12 nights" */
  when: string;
  origin: ScenePoint;
  dests: ScenePoint[];
  /** First and last departure day, YYYY-MM-DD. */
  from: string;
  to: string;
  minNights: number;
  maxNights: number;
  airports: number;
  trips: number;
  capped: boolean;
}

/** The real search compares at most this many candidate trips. */
export const MAX_TRIPS = 40_000;

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface SceneSpec {
  route: string;
  origin: string;
  to: string;
  /** Airports to draw (all of the place's airports are counted). Defaults to all of them. */
  show?: string[];
  cheap: string[];
  months: [number, number];
  nights: [number, number];
}

const SPECS: SceneSpec[] = [
  { route: "Austin → anywhere in Japan", origin: "AUS", to: "country:JP", cheap: ["KIX", "FUK"], months: [1, 4], nights: [7, 12] },
  {
    route: "New York → Europe", origin: "city:New York|US", to: "region:Europe", months: [6, 8], nights: [5, 9],
    show: ["LHR", "CDG", "AMS", "FCO", "BCN", "MAD", "LIS", "ATH", "DUB", "BER", "VIE", "PRG", "CPH", "KEF"], cheap: ["LIS", "KEF", "BCN"],
  },
  {
    route: "Chicago → the Caribbean", origin: "city:Chicago|US", to: "region:Central America & Caribbean", months: [2, 2], nights: [4, 7],
    show: ["CUN", "MBJ", "NAS", "PLS", "AUA", "PUJ", "SJU", "HAV", "SJO", "BZE", "GCM", "MEX"], cheap: ["CUN", "SJU"],
  },
  {
    route: "Seattle → anywhere", origin: "SEA", to: "anywhere", months: [10, 10], nights: [5, 10],
    show: ["HNL", "NRT", "ICN", "TPE", "MEX", "CDG", "KEF", "LHR", "SYD", "BKK", "YVR", "JFK", "SJD", "LIM", "DPS"], cheap: ["SJD", "TPE", "HNL"],
  },
];

const point = (iata: string, cheap: string[]): ScenePoint | undefined => {
  const a = AIRPORT_BY_IATA[iata];
  return a ? { name: a.city, lon: a.lng, lat: a.lat, cheap: cheap.includes(iata) || undefined } : undefined;
};

/** Next occurrence (after today) of the month window's start. */
function windowFor(months: [number, number], today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const cur = Number(today.slice(5, 7));
  const year = months[0] > cur ? y : y + 1;
  const from = `${year}-${String(months[0]).padStart(2, "0")}-01`;
  const endMonth = months[1] === 12 ? `${year + 1}-01-01` : `${year}-${String(months[1] + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(endMonth, -1) };
}

export function homeScenes(today: string): HomeScene[] {
  return SPECS.map((s) => {
    const origin = resolvePlace(s.origin);
    const dest = resolvePlace(s.to);
    if (!origin || !dest) throw new Error(`Unknown place in homepage scene: ${s.origin} / ${s.to}`);
    const { from, to } = windowFor(s.months, today);
    const days = daysBetween(from, to) + 1;
    const lengths = s.nights[1] - s.nights[0] + 1;
    const raw = origin.airports.length * dest.airports.length * days * lengths;
    const o = AIRPORT_BY_IATA[origin.airports[0]];
    return {
      route: s.route,
      when: `${s.months[0] === s.months[1] ? SHORT[s.months[0] - 1] : `${SHORT[s.months[0] - 1]}–${SHORT[s.months[1] - 1]}`} · ${s.nights[0]}–${s.nights[1]} nights`,
      origin: { name: o.city, lon: o.lng, lat: o.lat },
      dests: (s.show ?? dest.airports).map((c) => point(c, s.cheap)).filter((p): p is ScenePoint => !!p),
      from, to, minNights: s.nights[0], maxNights: s.nights[1],
      airports: origin.airports.length * dest.airports.length,
      trips: Math.min(raw, MAX_TRIPS),
      capped: raw > MAX_TRIPS,
    };
  });
}
