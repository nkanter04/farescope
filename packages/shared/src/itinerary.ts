import { z } from "zod";
import { addDays, daysBetween } from "./dates.ts";
import { CABINS } from "./types.ts";

/**
 * Multi-stop trip planner: which legs to price, how many credits that takes, and an exact optimizer
 * that picks the start date, nights per stop and (optionally) the order of stops with the lowest
 * total for flights plus "own way" legs. Pure and browser-safe; no price math anywhere else.
 *
 * Nodes: 0 = home, 1..n = stops in the order entered, n+1 = a different end place (if any).
 * Dates are departure dates; a leg arrives the day it departs for planning purposes.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const MAX_STOPS = 6;
export const MAX_REORDER_STOPS = 4;
export const MAX_START_WINDOW_DAYS = 90;
export const MAX_NIGHTS = 30;
/** Airlines publish about 11 months out. */
export const PLAN_HORIZON_DAYS = 330;

export const PlanStopSchema = z
  .object({
    place: z.string().trim().min(1).max(100),
    minNights: z.number().int().min(1).max(MAX_NIGHTS),
    maxNights: z.number().int().min(1).max(MAX_NIGHTS),
  })
  .refine((s) => s.minNights <= s.maxNights, { message: "Each stop's fewest nights must be at most its most nights" });

/** A leg between two nodes travelled your own way (train, bus, drive) at a fixed cost, either direction. */
export const GroundLegSchema = z.object({
  a: z.number().int().min(0),
  b: z.number().int().min(0),
  cost: z.number().nonnegative().max(100_000),
});

export const PlanRequestSchema = z
  .object({
    home: z.string().trim().min(1).max(100),
    stops: z.array(PlanStopSchema).min(1).max(MAX_STOPS),
    /** "home": fly back home; "last": end at the last stop; "place": end somewhere else. */
    end: z.enum(["home", "last", "place"]).default("home"),
    endPlace: z.string().trim().min(1).max(100).optional(),
    ground: z.array(GroundLegSchema).max(20).default([]),
    startFrom: isoDate,
    startTo: isoDate,
    reorder: z.boolean().default(false),
    cabin: z.enum(CABINS).default("economy"),
    adults: z.number().int().min(1).max(9).default(1),
    maxStops: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]).default(null),
  })
  .refine((r) => r.startFrom <= r.startTo, { message: "The start window must begin before it ends" })
  .refine((r) => daysBetween(r.startFrom, r.startTo) < MAX_START_WINDOW_DAYS, { message: `The start window can be at most ${MAX_START_WINDOW_DAYS} days` })
  .refine((r) => !r.reorder || r.stops.length <= MAX_REORDER_STOPS, { message: `Trying other orders works with up to ${MAX_REORDER_STOPS} stops` })
  .refine((r) => r.end !== "place" || !!r.endPlace, { message: "Choose where the trip ends" });

export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export interface PlanNode {
  id: number;
  place: string;
}

/** Home, the stops, and a separate end place when there is one. */
export function planNodes(r: PlanRequest): PlanNode[] {
  const nodes = [{ id: 0, place: r.home }, ...r.stops.map((s, i) => ({ id: i + 1, place: s.place }))];
  if (r.end === "place" && r.endPlace) nodes.push({ id: r.stops.length + 1, place: r.endPlace });
  return nodes;
}

/** Where the trip ends: home (0), the end place (n+1), or nowhere (null: the trip ends at the last stop). */
export function endNode(r: PlanRequest): number | null {
  return r.end === "home" ? 0 : r.end === "place" ? r.stops.length + 1 : null;
}

export function groundCost(r: PlanRequest, from: number, to: number): number | undefined {
  return r.ground.find((g) => (g.a === from && g.b === to) || (g.a === to && g.b === from))?.cost;
}

export interface PlannedLeg {
  from: number;
  to: number;
  /** First and last departure dates this leg could need. */
  dateFrom: string;
  dateTo: string;
}

const clampDate = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d);

/**
 * The flown legs to price (ground legs need no lookup), each with the dates it could depart.
 * In stop order: leg k departs between startFrom + the fewest nights so far and startTo + the most.
 * With reorder: every pair, over the whole span the trip could cover.
 */
export function planLegs(r: PlanRequest, today: string): PlannedLeg[] {
  const n = r.stops.length;
  const end = endNode(r);
  const last = addDays(today, PLAN_HORIZON_DAYS);
  const totalMax = r.stops.reduce((s, x) => s + x.maxNights, 0);
  const pairs: { from: number; to: number; lo: string; hi: string }[] = [];
  if (!r.reorder) {
    let minSum = 0;
    let maxSum = 0;
    for (let k = 0; k <= n; k++) {
      const from = k === 0 ? 0 : k;
      const to = k < n ? k + 1 : end;
      if (k > 0) {
        minSum += r.stops[k - 1].minNights;
        maxSum += r.stops[k - 1].maxNights;
      }
      if (to === null) break;
      pairs.push({ from, to, lo: addDays(r.startFrom, minSum), hi: addDays(r.startTo, maxSum) });
    }
  } else {
    const minStay = Math.min(...r.stops.map((s) => s.minNights));
    for (let i = 1; i <= n; i++) {
      pairs.push({ from: 0, to: i, lo: r.startFrom, hi: r.startTo });
      for (let j = 1; j <= n; j++) if (i !== j) pairs.push({ from: i, to: j, lo: addDays(r.startFrom, minStay), hi: addDays(r.startTo, totalMax) });
      if (end !== null) pairs.push({ from: i, to: end, lo: addDays(r.startFrom, minStay), hi: addDays(r.startTo, totalMax) });
    }
  }
  return pairs
    .filter((p) => groundCost(r, p.from, p.to) === undefined)
    .map((p) => ({ from: p.from, to: p.to, dateFrom: clampDate(p.lo, today, last), dateTo: clampDate(p.hi, today, last) }))
    .filter((p) => p.dateFrom <= p.dateTo);
}

/** Upper bound on live lookups: one per flown leg per `maxDays` of dates (cached legs are free). */
export function creditEstimate(r: PlanRequest, today: string, maxDays = 121): number {
  return planLegs(r, today).reduce((s, l) => s + Math.ceil((daysBetween(l.dateFrom, l.dateTo) + 1) / maxDays), 0);
}

// ---- Optimizer -------------------------------------------------------------------------------

/** Lowest price for a flown leg on a date, or undefined when there's no fare that day. */
export type LegPrice = (from: number, to: number, date: string) => number | undefined;

export interface ItineraryLeg {
  from: number;
  to: number;
  fromPlace: string;
  toPlace: string;
  date: string;
  price: number;
  mode: "fly" | "ground";
}

export interface ItineraryStay {
  node: number;
  place: string;
  checkIn: string;
  checkOut: string;
  nights: number;
}

export interface ItineraryOption {
  total: number;
  /** Stop nodes in travel order. */
  order: number[];
  start: string;
  end: string;
  legs: ItineraryLeg[];
  stays: ItineraryStay[];
}

export interface ItineraryResult {
  best?: ItineraryOption;
  /** Next-best plans with a different start date or order. */
  alternatives: ItineraryOption[];
  /** Lowest total for each possible first-flight date (missing = no plan that day). */
  byStart: { date: string; total: number }[];
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * Exact minimum by dynamic programming over (position in the order, arrival date), solved backwards
 * so one pass gives the best total for every start date. For each order: h[k][d] is the cheapest way
 * to finish the trip after arriving at the k-th stop on day d.
 */
export function optimizeItinerary(r: PlanRequest, price: LegPrice, opts: { alternatives?: number } = {}): ItineraryResult {
  const n = r.stops.length;
  const nodes = planNodes(r);
  const placeOf = (id: number) => nodes.find((x) => x.id === id)?.place ?? "";
  const end = endNode(r);
  const span = daysBetween(r.startFrom, r.startTo) + r.stops.reduce((s, x) => s + x.maxNights, 0) + 1;
  const dateAt = (d: number) => addDays(r.startFrom, d);
  const cost = (from: number, to: number, d: number): number => {
    const g = groundCost(r, from, to);
    if (g !== undefined) return g;
    const p = price(from, to, dateAt(d));
    return p === undefined || !(p >= 0) ? Infinity : p;
  };
  const orders = r.reorder ? permutations(r.stops.map((_, i) => i + 1)) : [r.stops.map((_, i) => i + 1)];
  const windowDays = daysBetween(r.startFrom, r.startTo);
  const candidates: { total: number; order: number[]; start: number; next: Int16Array[] }[] = [];

  for (const order of orders) {
    // h[k][d]: cheapest cost to finish after arriving at order[k] on day d; next[k][d]: nights chosen there.
    const h: Float64Array[] = Array.from({ length: n }, () => new Float64Array(span).fill(Infinity));
    const next: Int16Array[] = Array.from({ length: n }, () => new Int16Array(span));
    for (let k = n - 1; k >= 0; k--) {
      const stop = r.stops[order[k] - 1];
      const after = k < n - 1 ? order[k + 1] : end;
      for (let d = 0; d < span; d++) {
        let best = Infinity;
        let bestN = 0;
        for (let nights = stop.minNights; nights <= stop.maxNights; nights++) {
          const leave = d + nights;
          if (leave >= span) break;
          const c = after === null ? 0 : cost(order[k], after, leave) + (k < n - 1 ? h[k + 1][leave] : 0);
          if (c < best) {
            best = c;
            bestN = nights;
          }
          if (after === null) break; // ending here: the fewest nights, no further cost
        }
        h[k][d] = best;
        next[k][d] = bestN;
      }
    }
    for (let s = 0; s <= windowDays; s++) {
      const total = cost(0, order[0], s) + h[0][s];
      if (Number.isFinite(total)) candidates.push({ total, order, start: s, next });
    }
  }

  const build = (c: (typeof candidates)[number]): ItineraryOption => {
    const legs: ItineraryLeg[] = [];
    const stays: ItineraryStay[] = [];
    const leg = (from: number, to: number, d: number) => {
      const g = groundCost(r, from, to);
      legs.push({ from, to, fromPlace: placeOf(from), toPlace: placeOf(to), date: dateAt(d), price: g ?? cost(from, to, d), mode: g === undefined ? "fly" : "ground" });
    };
    let d = c.start;
    leg(0, c.order[0], d);
    for (let k = 0; k < n; k++) {
      const nights = c.next[k][d];
      stays.push({ node: c.order[k], place: placeOf(c.order[k]), checkIn: dateAt(d), checkOut: dateAt(d + nights), nights });
      d += nights;
      const after = k < n - 1 ? c.order[k + 1] : end;
      if (after !== null) leg(c.order[k], after, d);
    }
    return { total: c.total, order: c.order, start: dateAt(c.start), end: dateAt(d), legs, stays };
  };

  candidates.sort((a, b) => a.total - b.total || a.start - b.start);
  const byStartMap = new Map<number, number>();
  for (const c of candidates) if (!byStartMap.has(c.start)) byStartMap.set(c.start, c.total);
  const picked: (typeof candidates)[number][] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.start}|${c.order.join()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
    if (picked.length > (opts.alternatives ?? 3)) break;
  }
  return {
    best: picked[0] ? build(picked[0]) : undefined,
    alternatives: picked.slice(1).map(build),
    byStart: [...byStartMap.entries()].sort(([a], [b]) => a - b).map(([s, total]) => ({ date: dateAt(s), total })),
  };
}
