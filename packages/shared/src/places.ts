import { AIRPORTS, AIRPORT_BY_IATA, COUNTRIES, REGIONS, type Airport } from "./airports.ts";
import placeIds from "./data/place-ids.json";

export type PlaceKind = "airport" | "city" | "state" | "country" | "region" | "anywhere";

/** Google location IDs (Freebase "kgmid", from Wikidata) for countries and US states. */
const COUNTRY_IDS = placeIds.countries as Record<string, string>;
export const US_STATES = placeIds.states as Record<string, { name: string; id: string }>;
/** Google area IDs for each travel region (some regions span two Google areas). */
export const REGION_IDS = placeIds.regions as Record<string, string[]>;

export interface Place {
  kind: PlaceKind;
  /** Canonical token to send back to the server (e.g. "AUS", "city:Tokyo", "country:JP"). */
  token: string;
  label: string;
  sublabel: string;
  airports: string[];
  /** Google location ID for the whole place (countries, US states), when known. */
  googleId?: string;
}

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const CITY_ALIASES: Record<string, string> = { philly: "philadelphia", "st petersburg": "saint petersburg", "st. petersburg": "saint petersburg" };
const byCity = new Map<string, string[]>();
const byCountry = new Map<string, Airport[]>();
const byRegion = new Map<string, Airport[]>();
const byState = new Map<string, Airport[]>();
for (const airport of AIRPORTS) {
  if (airport.country === "US" && airport.state) byState.set(airport.state, [...(byState.get(airport.state) ?? []), airport]);
  const cityKey = `${airport.city}|${airport.country}`;
  byCity.set(cityKey, [...(byCity.get(cityKey) ?? []), airport.iata]);
  byCountry.set(airport.country, [...(byCountry.get(airport.country) ?? []), airport]);
  const region = COUNTRIES[airport.country]?.region;
  if (region) byRegion.set(region, [...(byRegion.get(region) ?? []), airport]);
}

/**
 * Broad places expand to the airports travelers actually use: major ones, falling back to regional,
 * then to everything for places that have no larger airport. Every airport stays reachable by its
 * city name or IATA code. This keeps "Japan" at 8 airports instead of 83, which matters because a
 * live provider covers only a few airports per call and the free tier allows only a few calls.
 */
function mainAirports(list: Airport[]): string[] {
  const major = list.filter((a) => a.tier === "major");
  if (major.length) return major.map((a) => a.iata);
  const regional = list.filter((a) => a.tier !== "local");
  return (regional.length ? regional : list).map((a) => a.iata);
}
const airportWord = (n: number) => `${n} main airport${n === 1 ? "" : "s"}`;

function cityPlace(city: string, country: string): Place {
  const airports = byCity.get(`${city}|${country}`) ?? [];
  return {
    kind: "city",
    token: `city:${city}|${country}`,
    label: city,
    sublabel: `${COUNTRIES[country]?.name ?? country} · ${airports.join(", ")}`,
    airports,
  };
}

function countryPlace(code: string): Place {
  const airports = mainAirports(byCountry.get(code) ?? []);
  return { kind: "country", token: `country:${code}`, label: COUNTRIES[code].name, sublabel: airportWord(airports.length), airports, googleId: COUNTRY_IDS[code] };
}

function statePlace(code: string): Place | undefined {
  const state = US_STATES[code];
  const airports = mainAirports(byState.get(code) ?? []);
  if (!state || !airports.length) return undefined;
  return { kind: "state", token: `state:US-${code}`, label: state.name, sublabel: `US state · ${airportWord(airports.length)}`, airports, googleId: state.id };
}

function regionPlace(region: string): Place {
  const airports = mainAirports(byRegion.get(region) ?? []);
  return { kind: "region", token: `region:${region}`, label: region, sublabel: airportWord(airports.length), airports };
}

function airportPlace(a: Airport): Place {
  return {
    kind: "airport",
    token: a.iata,
    label: `${a.city} (${a.iata})`,
    sublabel: `${a.name} · ${COUNTRIES[a.country]?.name ?? a.country}`,
    airports: [a.iata],
  };
}

const ANYWHERE_AIRPORTS = mainAirports(AIRPORTS);
const ANYWHERE: Place = {
  kind: "anywhere",
  token: "anywhere",
  label: "Anywhere",
  sublabel: `${ANYWHERE_AIRPORTS.length} main airports worldwide`,
  airports: ANYWHERE_AIRPORTS,
};

/** Resolve a canonical token (or a loose user string) into a set of airports. */
export function resolvePlace(input: string): Place | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  const n = norm(raw);
  if (n === "anywhere" || n === "everywhere") return ANYWHERE;

  if (raw.startsWith("city:")) {
    const [city, country] = raw.slice(5).split("|");
    const p = cityPlace(city, country);
    return p.airports.length ? p : undefined;
  }
  if (raw.startsWith("country:")) {
    const code = raw.slice(8).toUpperCase();
    return COUNTRIES[code] ? countryPlace(code) : undefined;
  }
  if (raw.startsWith("state:US-")) return statePlace(raw.slice(9).toUpperCase());
  if (raw.startsWith("region:")) {
    const region = REGIONS.find((r) => norm(r) === norm(raw.slice(7)));
    return region ? regionPlace(region) : undefined;
  }

  const up = raw.toUpperCase();
  if (AIRPORT_BY_IATA[up]) return airportPlace(AIRPORT_BY_IATA[up]);

  const region = REGIONS.find((r) => norm(r) === n);
  if (region) return regionPlace(region);

  const countryCode = Object.keys(COUNTRIES).find(
    (c) => norm(COUNTRIES[c].name) === n || (COUNTRIES[c].aliases ?? []).includes(n),
  );
  if (countryCode) return countryPlace(countryCode);

  // A US city with the same name ("New York", "Washington") wins over the state.
  const stateCode = Object.keys(US_STATES).find((c) => norm(US_STATES[c].name) === n);
  const state = stateCode && !AIRPORTS.some((a) => a.country === "US" && norm(a.city) === n) ? statePlace(stateCode) : undefined;
  if (state) return state;

  const cityAirport = AIRPORTS.find((a) => norm(a.city) === (CITY_ALIASES[n] ?? n));
  if (cityAirport) return cityPlace(cityAirport.city, cityAirport.country);

  return undefined;
}

/** Autocomplete suggestions, best matches first. */
export function suggestPlaces(query: string, limit = 8): Place[] {
  const n = CITY_ALIASES[norm(query)] ?? norm(query);
  if (!n) return [];
  const out: { place: Place; score: number }[] = [];
  const seen = new Set<string>();
  const push = (place: Place, score: number) => {
    if (seen.has(place.token)) return;
    seen.add(place.token);
    out.push({ place, score });
  };
  const scoreText = (text: string) => {
    const t = norm(text);
    if (t === n) return 100;
    if (t.startsWith(n)) return 80;
    if (t.split(/[\s-]+/).some((w) => w.startsWith(n))) return 60;
    if (n.length >= 3 && t.includes(n)) return 40;
    return 0;
  };

  if ("anywhere".startsWith(n)) push(ANYWHERE, 70);
  for (const r of REGIONS) {
    const s = scoreText(r);
    if (s) push(regionPlace(r), s + 5);
  }
  for (const code of Object.keys(COUNTRIES)) {
    const c = COUNTRIES[code];
    const s = Math.max(scoreText(c.name), ...(c.aliases ?? []).map(scoreText), n.length === 2 && code === n.toUpperCase() ? 70 : 0);
    if (s) push(countryPlace(code), s + 4);
  }
  for (const code of Object.keys(US_STATES)) {
    const s = scoreText(US_STATES[code].name);
    const p = s ? statePlace(code) : undefined;
    if (p) push(p, s + 4);
  }
  const cities = new Map<string, Airport>();
  for (const a of AIRPORTS) cities.set(`${a.city}|${a.country}`, a);
  for (const a of cities.values()) {
    const s = scoreText(a.city);
    const p = cityPlace(a.city, a.country);
    if (s && p.airports.length > 1) push(p, s + 3);
  }
  for (const a of AIRPORTS) {
    const s = Math.max(a.iata === n.toUpperCase() ? 110 : 0, scoreText(a.city), scoreText(a.name) - 10);
    if (s > 0) push(airportPlace(a), s);
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit).map((o) => o.place);
}

/** Union of airports for a list of tokens; unknown tokens are reported back. */
export function resolveAll(tokens: string[]): { airports: string[]; places: Place[]; unknown: string[] } {
  const airports = new Set<string>();
  const places: Place[] = [];
  const unknown: string[] = [];
  for (const t of tokens) {
    const p = resolvePlace(t);
    if (!p) unknown.push(t);
    else {
      places.push(p);
      p.airports.forEach((a) => airports.add(a));
    }
  }
  return { airports: [...airports], places, unknown };
}
