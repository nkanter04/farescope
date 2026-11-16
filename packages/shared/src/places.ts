import { AIRPORTS, AIRPORT_BY_IATA, COUNTRIES, REGIONS, type Airport } from "./airports.ts";

export type PlaceKind = "airport" | "city" | "country" | "region" | "anywhere";

export interface Place {
  kind: PlaceKind;
  /** Canonical token to send back to the server (e.g. "AUS", "city:Tokyo", "country:JP"). */
  token: string;
  label: string;
  sublabel: string;
  airports: string[];
}

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function cityPlace(city: string, country: string): Place {
  const airports = AIRPORTS.filter((a) => a.city === city && a.country === country).map((a) => a.iata);
  return {
    kind: "city",
    token: `city:${city}|${country}`,
    label: city,
    sublabel: `${COUNTRIES[country]?.name ?? country} · ${airports.join(", ")}`,
    airports,
  };
}

function countryPlace(code: string): Place {
  const airports = AIRPORTS.filter((a) => a.country === code).map((a) => a.iata);
  return { kind: "country", token: `country:${code}`, label: COUNTRIES[code].name, sublabel: `${airports.length} airports`, airports };
}

function regionPlace(region: string): Place {
  const airports = AIRPORTS.filter((a) => COUNTRIES[a.country]?.region === region).map((a) => a.iata);
  return { kind: "region", token: `region:${region}`, label: region, sublabel: `${airports.length} airports`, airports };
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

const ANYWHERE: Place = {
  kind: "anywhere",
  token: "anywhere",
  label: "Anywhere",
  sublabel: `All ${AIRPORTS.length} airports`,
  airports: AIRPORTS.map((a) => a.iata),
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

  const cityAirport = AIRPORTS.find((a) => norm(a.city) === n);
  if (cityAirport) return cityPlace(cityAirport.city, cityAirport.country);

  return undefined;
}

/** Autocomplete suggestions, best matches first. */
export function suggestPlaces(query: string, limit = 8): Place[] {
  const n = norm(query);
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
