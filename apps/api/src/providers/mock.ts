import {
  AIRPORT_BY_IATA,
  COUNTRIES,
  addDays,
  curveAt,
  daysBetween,
  distanceKm,
  parseISODate,
  regionOf,
  resolvePlace,
  todayISO,
  type BookingCurve,
  type Fare,
  type FlightLeg,
  type PricePoint,
  type Stay,
  type StayKind,
} from "@farescope/shared";
import type { FlightProvider, FlightQuery, FlightResult, StayProvider, StayQuery } from "./types.ts";
import { demoPaths } from "./routes.ts";

/**
 * Deterministic fake data for development: same query -> same prices, so the UI is stable and
 * tests are reproducible. Prices follow plausible patterns (distance, season, weekday, advance
 * purchase) so the calendar heatmap looks like a real fare calendar.
 */

/** FNV-1a 32-bit hash -> [0, 1). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

const AIRLINES_BY_REGION: Record<string, string[]> = {
  "North America": ["American", "Delta", "United", "Southwest", "Alaska", "Air Canada", "JetBlue"],
  "Central America & Caribbean": ["Aeromexico", "Copa", "Volaris", "American", "JetBlue"],
  "South America": ["LATAM", "Avianca", "Aerolineas Argentinas", "GOL"],
  Europe: ["British Airways", "Lufthansa", "Air France", "KLM", "Iberia", "Turkish Airlines", "TAP", "Ryanair"],
  "Middle East": ["Emirates", "Qatar Airways", "Etihad", "El Al"],
  Africa: ["Ethiopian", "Kenya Airways", "Royal Air Maroc", "EgyptAir", "South African"],
  Asia: ["ANA", "Japan Airlines", "Korean Air", "Singapore Airlines", "Cathay Pacific", "EVA Air", "Thai Airways"],
  Oceania: ["Qantas", "Air New Zealand", "Virgin Australia", "Fiji Airways"],
};

const CABIN_MULT = { economy: 1, premium: 1.7, business: 3.6, first: 6 } as const;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(Math.round(mins) % 60)}`;

function basePrice(from: string, to: string): number {
  const a = AIRPORT_BY_IATA[from];
  const b = AIRPORT_BY_IATA[to];
  const km = distanceKm(a, b);
  return 60 + km * 0.075 + Math.sqrt(km) * 1.2;
}

function seasonMult(date: string): number {
  const d = parseISODate(date);
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  let mult = [0.88, 0.85, 0.98, 1.0, 1.02, 1.18, 1.25, 1.15, 0.95, 0.97, 0.92, 1.1][m];
  if (m === 11 && day >= 18) mult += 0.3; // holidays
  if (m === 0 && day <= 3) mult += 0.2;
  const dow = d.getUTCDay();
  mult *= [1.1, 0.97, 0.9, 0.91, 1.03, 1.12, 0.98][dow];
  return mult;
}

/**
 * The demo's "true" booking curve (price multiplier by days before departure). It deliberately
 * differs from the forecast's prior so the demo shows the forecast learning from data. Each route
 * gets its own steepness for the last-minute rise.
 */
const DEMO_CURVE = [1.6, 1.3, 1.12, 0.99, 0.93, 0.98, 1.1];
const routeCurves = new Map<string, BookingCurve>();
function routeCurve(from: string, to: string): BookingCurve {
  const key = `${from}${to}`;
  let curve = routeCurves.get(key);
  if (!curve) {
    const steep = 0.8 + 0.4 * hash01(`${key}curve`);
    curve = {
      multipliers: DEMO_CURVE.map((m, i) => (i < 3 ? 1 + (m - 1) * steep : m)),
      observations: DEMO_CURVE.map(() => 0),
      series: 0,
    };
    if (routeCurves.size > 5000) routeCurves.clear();
    routeCurves.set(key, curve);
  }
  return curve;
}

function advanceMult(from: string, to: string, departDate: string, today: string): number {
  return curveAt(routeCurve(from, to), daysBetween(today, departDate));
}

/**
 * Simulated price history: what this same flight would have cost on each of the past `days` days,
 * following the route's booking curve plus smooth market noise. Deterministic per flight.
 */
export function mockPriceHistory(fare: Fare, today: string, days = 60): PricePoint[] {
  const curve = routeCurve(fare.origin, fare.destination);
  const nowOut = daysBetween(today, fare.departDate);
  const seed = `${fare.origin}${fare.destination}${fare.departDate}${fare.returnDate ?? ""}`;
  const phase1 = hash01(`${seed}p1`) * Math.PI * 2;
  const phase2 = hash01(`${seed}p2`) * Math.PI * 2;
  const noise = (d: string, age: number) =>
    0.045 * Math.sin(age / 9 + phase1) + 0.025 * Math.sin(age / 3.7 + phase2) + (hash01(`${seed}${d}`) - 0.5) * 0.02;
  const out: PricePoint[] = [];
  for (let age = days; age >= 1; age--) {
    const date = addDays(today, -age);
    const daysOut = nowOut + age;
    if (daysOut > 330) continue; // fares go on sale ~11 months out
    const ratio = curveAt(curve, daysOut) / curveAt(curve, nowOut);
    out.push({ date, price: Math.round(fare.price * ratio * (1 + noise(date, age) - noise(today, 0))) });
  }
  return out;
}

const LOW_COST = new Set(["Southwest", "JetBlue", "Alaska", "Ryanair", "Volaris", "GOL"]);

function airlinesFor(from: string, to: string, km: number): string[] {
  const all = [...new Set([...(AIRLINES_BY_REGION[regionOf(from) ?? ""] ?? []), ...(AIRLINES_BY_REGION[regionOf(to) ?? ""] ?? [])])];
  return km > 4_500 ? all.filter((a) => !LOW_COST.has(a)) : all;
}

function makeFare(q: FlightQuery, points: string[], option: number, today: string): Fare {
  const from = points[0];
  const to = points.at(-1)!;
  const seed = `${points.join("|")}|${q.departDate}|${q.returnDate ?? ""}|${option}`;
  const r = hash01(seed);
  const r2 = hash01(seed + "b");
  const km = distanceKm(AIRPORT_BY_IATA[from], AIRPORT_BY_IATA[to]);
  const stops = points.length - 2;
  const stopMult = stops === 0 ? 1.18 : stops === 1 ? 1.0 : 0.88;

  let price = basePrice(from, to) * seasonMult(q.departDate) * advanceMult(from, to, q.departDate, today) * stopMult;
  if (q.returnDate) price *= 1.75 * (0.92 + 0.16 * seasonMult(q.returnDate));
  price *= CABIN_MULT[q.cabin] * (0.85 + 0.3 * r) * q.adults;
  price = Math.round(price);

  const airlines = airlinesFor(from, to, km);
  const airline = airlines[Math.floor(hash01(seed + "al") * airlines.length)] ?? "Mock Air";
  const departMin = 6 * 60 + Math.floor(r * 16 * 60);

  const legs: FlightLeg[] = [];
  const stamp = (m: number) => `${addDays(q.departDate, Math.floor(m / 1440))} ${hhmm(m % 1440)}`;
  let t = departMin;
  for (let i = 0; i < points.length - 1; i++) {
    const legKm = distanceKm(AIRPORT_BY_IATA[points[i]], AIRPORT_BY_IATA[points[i + 1]]);
    const legDur = Math.round((legKm / 820) * 60 + 35);
    legs.push({
      from: points[i],
      to: points[i + 1],
      depart: stamp(t),
      arrive: stamp(t + legDur),
      airline,
      flightNumber: `${airline.slice(0, 2).toUpperCase()}${100 + Math.floor(hash01(seed + i) * 8900)}`,
      durationMin: legDur,
    });
    t += legDur + (i < points.length - 2 ? 70 + Math.floor(r2 * 120) : 0);
  }
  const durationMin = t - departMin;

  return {
    id: `mock-${Math.floor(r * 1e9).toString(36)}-${from}${to}${q.departDate}${option}`,
    provider: "mock",
    origin: from,
    destination: to,
    departDate: q.departDate,
    returnDate: q.returnDate,
    price,
    currency: "USD",
    airlines: [airline],
    stops,
    durationMin,
    outbound: legs,
    bookingUrl: `https://www.google.com/travel/flights?q=${encodeURIComponent(
      `Flights from ${from} to ${to} on ${q.departDate}${q.returnDate ? ` returning ${q.returnDate}` : ""}`,
    )}`,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

export function createMockFlightProvider(opts: { today?: () => string; latencyMs?: number } = {}): FlightProvider {
  const today = opts.today ?? (() => todayISO());
  return {
    name: "mock",
    live: false,
    maxAirportsPerSide: 50,
    priceHistory: (fare: Fare) => mockPriceHistory(fare, today()),
    async search(q: FlightQuery): Promise<FlightResult> {
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      const fares: Fare[] = [];
      for (const from of q.origins) {
        for (const to of q.destinations) {
          if (from === to || !AIRPORT_BY_IATA[from] || !AIRPORT_BY_IATA[to]) continue;
          const paths = demoPaths(from, to, q.maxStops ?? 2);
          if (q.returnDate && !demoPaths(to, from, q.maxStops ?? 2).length) continue;
          for (const [i, path] of paths.entries()) fares.push(makeFare(q, path, i, today()));
        }
      }
      fares.sort((a, b) => a.price - b.price);
      const prices = fares.map((f) => f.price);
      return {
        fares,
        insights: prices.length ? { lowestPrice: prices[0], typicalRange: [prices[0], prices[prices.length - 1]] } : undefined,
      };
    },
  };
}

const STAY_NAMES: Record<StayKind, string[]> = {
  hotel: ["Grand", "Central", "Harbor", "Garden", "Plaza", "Skyline", "Riverside", "Royal", "Park"],
  hostel: ["Backpackers", "Nomad", "Wanderer", "Base Camp", "Social"],
  rental: ["Cozy Loft", "Sunny Apartment", "Modern Studio", "Family House", "Penthouse", "Townhouse"],
};

export function createMockStayProvider(): StayProvider {
  return {
    name: "mock",
    live: false,
    callsPerSearch: 0,
    async search(q: StayQuery): Promise<Stay[]> {
      const locationAirport = q.location ? resolvePlace(q.location)?.airports[0] : q.airport;
      const ap = AIRPORT_BY_IATA[locationAirport ?? q.airport];
      if (!ap) return [];
      const city = q.location || ap.city;
      const cost = COUNTRIES[ap.country]?.costIndex ?? 1;
      const nights = Math.max(1, daysBetween(q.checkIn, q.checkOut));
      const season = seasonMult(q.checkIn);
      const out: Stay[] = [];
      const kindCount: Record<StayKind, number> = { hotel: 0, hostel: 0, rental: 0 };
      for (let i = 0; i < 14; i++) {
        const seed = `${city}|${i}`;
        const kind: StayKind = i % 7 === 3 || i % 7 === 6 ? "hostel" : i % 3 === 1 ? "rental" : "hotel";
        const stars = kind === "hotel" ? 2 + Math.floor(hash01(seed + "st") * 4) : undefined;
        const base = kind === "hostel" ? 32 : kind === "rental" ? 115 : 70 + (stars ?? 3) * 38;
        const nightly = Math.round(base * cost * season * (0.75 + 0.5 * hash01(seed + q.checkIn)));
        const names = STAY_NAMES[kind];
        const label = names[(kindCount[kind]++ + Math.floor(hash01(city) * names.length)) % names.length];
        const name =
          kind === "hotel" ? `${label} Hotel ${city}` : kind === "hostel" ? `${city} ${label} Hostel` : `${label} near ${city} center`;
        out.push({
          id: `mockstay-${ap.iata}-${i}`,
          provider: "mock",
          name,
          kind,
          lat: locationAirport ? ap.lat + (hash01(seed + "lat") - 0.5) * 0.25 : undefined,
          lng: locationAirport ? ap.lng + (hash01(seed + "lng") - 0.5) * 0.25 : undefined,
          nightly,
          total: nightly * nights * Math.max(1, Math.ceil(q.adults / 2)),
          rating: Math.round((3.4 + hash01(seed + "rt") * 1.55) * 10) / 10,
          reviews: Math.floor(40 + hash01(seed + "rv") * 3000),
          stars,
          checkIn: q.checkIn,
          checkOut: q.checkOut,
          url: `https://www.google.com/travel/search?q=${encodeURIComponent(`${name}`)}`,
          amenities: ["Wi-Fi", kind === "hotel" ? "Breakfast" : "Kitchen", hash01(seed + "am") > 0.5 ? "Air conditioning" : "Laundry"],
        });
      }
      return out.sort((a, b) => a.total - b.total);
    },
  };
}
