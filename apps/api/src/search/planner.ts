import { addDays, daysBetween, resolveAll, type SearchRequest } from "@farescope/shared";
import { flightQueryKey, type FlightQuery } from "../providers/types.ts";

export interface Candidate {
  key: string;
  query: FlightQuery;
  /** Index of the origin-chunk x destination-chunk route group. */
  routeGroup: number;
  nights: number | null;
}

export interface Plan {
  candidates: Candidate[];
  totalCandidates: number;
  routeGroups: number;
  /** Airports of each route group (index = routeGroup). */
  routes: { origins: string[]; destinations: string[] }[];
  /** First and last departure dates searched. */
  departFrom: string;
  departTo: string;
  originAirports: string[];
  destinationAirports: string[];
  unknown: string[];
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Expand a flexible search into every concrete provider call it could make:
 * (origin chunk x destination chunk) x (departure date x trip length).
 * Multi-airport chunks let one call cover e.g. "AUS -> all of Japan".
 */
export function planSearch(req: SearchRequest, provider: { name: string; maxAirportsPerSide: number }, today: string): Plan {
  const o = resolveAll(req.origins);
  const d = resolveAll(req.destinations);
  const origins = o.airports;
  const destinations = d.airports.filter((a) => !(origins.length === 1 && a === origins[0]));

  const from = req.departFrom < today ? today : req.departFrom;
  const datePairs: { depart: string; ret?: string; nights: number | null }[] = [];
  for (let day = from; day <= req.departTo; day = addDays(day, 1)) {
    if (req.tripType === "oneway") datePairs.push({ depart: day, nights: null });
    else for (let n = req.minNights; n <= req.maxNights; n++) datePairs.push({ depart: day, ret: addDays(day, n), nights: n });
  }

  const oChunks = chunk(origins, provider.maxAirportsPerSide);
  const dChunks = chunk(destinations, provider.maxAirportsPerSide);
  const candidates: Candidate[] = [];
  const routeGroups = oChunks.length * dChunks.length;
  const totalCandidates = routeGroups * datePairs.length;
  const count = Math.min(totalCandidates, 40_000);
  // Index the Cartesian product so broad global searches never allocate millions of candidates.
  for (let i = 0; i < count; i++) {
    const index = count === 1 ? 0 : Math.round(i * (totalCandidates - 1) / (count - 1));
    const group = Math.floor(index / datePairs.length);
    const oc = oChunks[Math.floor(group / dChunks.length)];
    const dc = dChunks[group % dChunks.length];
    const p = datePairs[index % datePairs.length];
    const query: FlightQuery = {
      origins: oc,
      destinations: dc,
      departDate: p.depart,
      returnDate: p.ret,
      cabin: req.cabin,
      maxStops: req.maxStops,
      adults: req.adults,
      airlines: req.airlines?.length ? req.airlines : undefined,
    };
    candidates.push({ key: flightQueryKey(provider.name, query), query, routeGroup: group, nights: p.nights });
  }
  const routes = Array.from({ length: routeGroups }, (_, g) => ({ origins: oChunks[Math.floor(g / dChunks.length)], destinations: dChunks[g % dChunks.length] }));
  return {
    candidates,
    routeGroups,
    routes,
    departFrom: from,
    departTo: req.departTo,
    totalCandidates,
    originAirports: origins,
    destinationAirports: destinations,
    unknown: [...o.unknown, ...d.unknown],
  };
}

/** Pick `n` items spread evenly across `xs` (always includes first and last when n >= 2). */
export function spread<T>(xs: T[], n: number): T[] {
  if (n >= xs.length) return [...xs];
  if (n <= 0) return [];
  if (n === 1) return [xs[Math.floor(xs.length / 2)]];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
  return out;
}

/**
 * First-pass sample when we can't afford every candidate: share the budget across route groups,
 * and within each group spread calls evenly over the date window (mid-length trips first).
 */
export function sampleCandidates(cands: Candidate[], budget: number): Candidate[] {
  if (budget >= cands.length) return [...cands];
  const groups = new Map<number, Candidate[]>();
  for (const c of cands) {
    const g = groups.get(c.routeGroup) ?? [];
    g.push(c);
    groups.set(c.routeGroup, g);
  }
  const groupIds = [...groups.keys()];
  if (budget < groupIds.length) {
    return spread(groupIds, budget).map((g) => pickMidLength(groups.get(g)!, 1)[0]);
  }
  const out: Candidate[] = [];
  const base = Math.floor(budget / groupIds.length);
  let extra = budget - base * groupIds.length;
  for (const g of groupIds) {
    const n = base + (extra-- > 0 ? 1 : 0);
    out.push(...pickMidLength(groups.get(g)!, n));
  }
  return out;
}

/** Spread over departure dates, preferring the middle trip length, then fill other lengths. */
function pickMidLength(group: Candidate[], n: number): Candidate[] {
  const lengths = [...new Set(group.map((c) => c.nights))].sort((a, b) => (a ?? 0) - (b ?? 0));
  const mid = lengths[Math.floor(lengths.length / 2)];
  const midOnes = group.filter((c) => c.nights === mid);
  const picked = spread(midOnes, n);
  if (picked.length < n) {
    const rest = group.filter((c) => c.nights !== mid);
    picked.push(...spread(rest, n - picked.length));
  }
  return picked;
}

/**
 * Second pass: spend leftover budget on the not-yet-tried candidates nearest (in date and trip
 * length) to the cheapest results found so far. That is where cheaper fares are most likely.
 */
export function refineCandidates(
  cands: Candidate[],
  tried: Set<string>,
  best: { routeGroup: number; departDate: string; nights: number | null }[],
  n: number,
): Candidate[] {
  if (n <= 0 || best.length === 0) return [];
  const scored: { c: Candidate; score: number }[] = [];
  for (const c of cands) {
    if (tried.has(c.key)) continue;
    let s = Infinity;
    for (const b of best) {
      if (b.routeGroup !== c.routeGroup) continue;
      const dd = Math.abs(daysBetween(b.departDate, c.query.departDate));
      const dn = Math.abs((b.nights ?? 0) - (c.nights ?? 0));
      s = Math.min(s, dd + dn * 0.75);
    }
    if (s < Infinity) scored.push({ c, score: s });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map((x) => x.c);
}
