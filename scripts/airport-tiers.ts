/**
 * Tags each airport in packages/shared/src/data/airports.json with a size tier, derived from how
 * many distinct nonstop routes touch it in the OpenFlights route snapshot
 * (apps/api/src/providers/data/routes.json):
 *
 *   major    >= 20 routes  (in Japan: NRT, HND, KIX, ITM, NGO, CTS, FUK, OKA)
 *   regional >=  5 routes
 *   local     <  5 routes (incl. airports missing from the 2014 snapshot)
 *
 * Country, region and "Anywhere" searches expand to major airports only, so a search for "Japan"
 * spends its limited live-provider calls on the airports travelers actually use. Airports in the
 * hand-curated list in airports.ts are always treated as major at runtime (e.g. BER opened after
 * the 2014 snapshot).
 *
 * Run from the repo root after importing new data:  npx tsx scripts/airport-tiers.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAJOR_MIN_ROUTES = 20;
export const REGIONAL_MIN_ROUTES = 5;

const root = fileURLToPath(new URL("..", import.meta.url));
const airportsPath = `${root}packages/shared/src/data/airports.json`;
const routesPath = `${root}apps/api/src/providers/data/routes.json`;

type Row = { iata: string; name: string; city: string; country: string; lat: number; lng: number; tier?: string };

const airports = JSON.parse(readFileSync(airportsPath, "utf8")) as Row[];
const routes = JSON.parse(readFileSync(routesPath, "utf8")) as Record<string, string[]>;

// Distinct airports connected by a nonstop route in either direction.
const neighbors = new Map<string, Set<string>>();
const link = (a: string, b: string) => {
  if (!neighbors.has(a)) neighbors.set(a, new Set());
  neighbors.get(a)!.add(b);
};
for (const [origin, destinations] of Object.entries(routes)) {
  for (const destination of destinations) {
    link(origin, destination);
    link(destination, origin);
  }
}

const counts = { major: 0, regional: 0, local: 0 };
const rows = airports.map(({ tier: _old, ...airport }) => {
  const n = neighbors.get(airport.iata)?.size ?? 0;
  const tier = n >= MAJOR_MIN_ROUTES ? "major" : n >= REGIONAL_MIN_ROUTES ? "regional" : "local";
  counts[tier]++;
  return { ...airport, tier };
});

// Same one-row-per-line layout as the import script, so diffs stay readable.
writeFileSync(airportsPath, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`Tagged ${rows.length} airports: ${counts.major} major, ${counts.regional} regional, ${counts.local} local`);
