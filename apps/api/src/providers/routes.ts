import { AIRPORT_BY_IATA, distanceKm } from "@farescope/shared";
import routeData from "./data/routes.json";

/** Historical connections for the demo only. Live search uses provider itineraries. */
const routes: Record<string, string[]> = routeData;
const neighbors = new Map(Object.entries(routes).map(([origin, destinations]) => [origin, new Set(destinations)]));
const pathCache = new Map<string, string[][]>();

export function demoPaths(from: string, to: string, maxStops = 2): string[][] {
  const key = `${from}|${to}|${maxStops}`;
  const cached = pathCache.get(key);
  if (cached) return cached;
  if (!AIRPORT_BY_IATA[from] || !AIRPORT_BY_IATA[to] || from === to) return [];
  const paths: string[][] = [];
  if (neighbors.get(from)?.has(to)) paths.push([from, to]);
  const direct = distanceKm(AIRPORT_BY_IATA[from], AIRPORT_BY_IATA[to]);
  const distance = (path: string[]) => path.slice(1).reduce((sum, airport, i) =>
    sum + distanceKm(AIRPORT_BY_IATA[path[i]], AIRPORT_BY_IATA[airport]), 0);
  const candidates: string[][] = [];
  for (const first of routes[from] ?? []) {
    if (maxStops === 0) break;
    if (first === to) continue;
    if (neighbors.get(first)?.has(to)) candidates.push([from, first, to]);
    for (const second of routes[first] ?? []) {
      if (maxStops < 2) break;
      if (second !== from && second !== to && neighbors.get(second)?.has(to)) candidates.push([from, first, second, to]);
    }
  }
  // Keep two short routes at each stop count, with a generous bound on detours.
  const ranked = candidates.map(path => ({ path, km: distance(path) }))
    .filter(item => item.km <= direct * 1.8 + 500)
    .sort((a, b) => a.km - b.km || a.path.join().localeCompare(b.path.join()));
  for (const length of [3, 4]) paths.push(...ranked.filter(item => item.path.length === length).slice(0, 2).map(item => item.path));
  if (pathCache.size >= 2000) pathCache.delete(pathCache.keys().next().value!);
  pathCache.set(key, paths);
  return paths;
}

/** Nonstop destinations from an airport in the route graph: a rough size signal for picking a city's main airport. */
export function routeCount(iata: string): number {
  return routes[iata]?.length ?? 0;
}
