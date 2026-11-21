import { describe, expect, it } from "vitest";
import { addDays } from "./dates.ts";
import { creditEstimate, optimizeItinerary, planLegs, PlanRequestSchema, type LegPrice, type PlanRequest } from "./itinerary.ts";

const TODAY = "2026-11-20";
const req = (o: Partial<PlanRequest> & Pick<PlanRequest, "stops">): PlanRequest =>
  PlanRequestSchema.parse({ home: "AUS", startFrom: "2027-03-01", startTo: "2027-03-05", ...o });

/** Deterministic pseudo-random prices per leg and date. */
function prices(seed: number, missing = 0): LegPrice {
  return (from, to, date) => {
    let h = seed * 7919 + from * 104729 + to * 1299709 + Number(date.replaceAll("-", ""));
    h = (h ^ (h >>> 13)) * 1274126177;
    const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    if (r < missing) return undefined;
    return 100 + Math.round(r * 900);
  };
}

/** Every start date, nights combination and order, the slow way. */
function bruteForce(r: PlanRequest, price: LegPrice): number {
  const n = r.stops.length;
  const end = r.end === "home" ? 0 : r.end === "place" ? n + 1 : null;
  const ground = (a: number, b: number) => r.ground.find((g) => (g.a === a && g.b === b) || (g.a === b && g.b === a))?.cost;
  const legCost = (a: number, b: number, d: string) => ground(a, b) ?? price(a, b, d) ?? Infinity;
  const perms = (xs: number[]): number[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  const orders = r.reorder ? perms(r.stops.map((_, i) => i + 1)) : [r.stops.map((_, i) => i + 1)];
  let best = Infinity;
  for (const order of orders) {
    const walk = (k: number, day: string, acc: number) => {
      if (k === n) {
        best = Math.min(best, acc);
        return;
      }
      const stop = r.stops[order[k] - 1];
      const after = k < n - 1 ? order[k + 1] : end;
      for (let nights = stop.minNights; nights <= stop.maxNights; nights++) {
        const leave = addDays(day, nights);
        walk(k + 1, leave, acc + (after === null ? 0 : legCost(order[k], after, leave)));
        if (after === null) break;
      }
    };
    for (let s = r.startFrom; s <= r.startTo; s = addDays(s, 1)) walk(0, s, legCost(0, order[0], s));
  }
  return best;
}

describe("multi-stop planner", () => {
  it("matches brute force on random trips, in order and reordered, ending home, elsewhere or at the last stop", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const stops = Array.from({ length: 1 + (seed % 3) }, (_, i) => ({ place: `S${i}`, minNights: 1 + ((seed + i) % 3), maxNights: 3 + ((seed + i) % 3) }));
      const end = (["home", "last", "place"] as const)[seed % 3];
      const r = req({ stops, end, endPlace: end === "place" ? "SEA" : undefined, reorder: seed % 2 === 0, ground: seed % 4 === 0 ? [{ a: 1, b: Math.min(2, stops.length), cost: 120 }] : [] });
      const price = prices(seed, 0.15);
      const result = optimizeItinerary(r, price);
      const expected = bruteForce(r, price);
      if (!Number.isFinite(expected)) expect(result.best).toBeUndefined();
      else expect(result.best?.total).toBe(expected);
    }
  });

  it("returns a consistent plan: legs and stays chain together within the night ranges", () => {
    const r = req({ stops: [{ place: "TYO", minNights: 3, maxNights: 5 }, { place: "OSA", minNights: 2, maxNights: 4 }, { place: "SEL", minNights: 2, maxNights: 3 }], ground: [{ a: 1, b: 2, cost: 100 }] });
    const { best, byStart, alternatives } = optimizeItinerary(r, prices(7));
    expect(best).toBeDefined();
    const plan = best!;
    expect(plan.legs.map((l) => [l.fromPlace, l.toPlace, l.mode])).toEqual([["AUS", "TYO", "fly"], ["TYO", "OSA", "ground"], ["OSA", "SEL", "fly"], ["SEL", "AUS", "fly"]]);
    expect(plan.legs[1].price).toBe(100);
    expect(plan.total).toBe(plan.legs.reduce((s, l) => s + l.price, 0));
    plan.stays.forEach((s, i) => {
      expect(s.checkIn).toBe(plan.legs[i].date);
      expect(s.checkOut).toBe(plan.legs[i + 1].date);
      expect(s.nights).toBeGreaterThanOrEqual(r.stops[i].minNights);
      expect(s.nights).toBeLessThanOrEqual(r.stops[i].maxNights);
    });
    expect(plan.start >= r.startFrom && plan.start <= r.startTo).toBe(true);
    expect(Math.min(...byStart.map((b) => b.total))).toBe(plan.total);
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.every((a) => a.total >= plan.total)).toBe(true);
  });

  it("finds a cheaper order when reordering is allowed", () => {
    // Going home -> 2 first is far cheaper than home -> 1.
    const price: LegPrice = (from, to) => (from === 0 && to === 1 ? 2000 : 200);
    const stops = [{ place: "TYO", minNights: 2, maxNights: 2 }, { place: "SEL", minNights: 2, maxNights: 2 }];
    expect(optimizeItinerary(req({ stops }), price).best?.total).toBe(2400);
    const reordered = optimizeItinerary(req({ stops, reorder: true }), price).best!;
    expect(reordered.total).toBe(600);
    expect(reordered.stays.map((s) => s.place)).toEqual(["SEL", "TYO"]);
  });

  it("works out which legs to price, their dates, and the credit cost", () => {
    const r = req({ stops: [{ place: "TYO", minNights: 3, maxNights: 5 }, { place: "OSA", minNights: 2, maxNights: 4 }], ground: [{ a: 1, b: 2, cost: 100 }] });
    expect(planLegs(r, TODAY)).toEqual([
      { from: 0, to: 1, dateFrom: "2027-03-01", dateTo: "2027-03-05" },
      { from: 2, to: 0, dateFrom: "2027-03-06", dateTo: "2027-03-14" },
    ]);
    expect(creditEstimate(r, TODAY)).toBe(2);
    const three = [{ place: "A", minNights: 2, maxNights: 3 }, { place: "B", minNights: 2, maxNights: 3 }, { place: "C", minNights: 2, maxNights: 3 }];
    expect(creditEstimate(req({ stops: three }), TODAY)).toBe(4);
    expect(creditEstimate(req({ stops: three, reorder: true }), TODAY)).toBe(12);
    expect(creditEstimate(req({ stops: three, reorder: true, end: "last" }), TODAY)).toBe(9);
  });

  it("validates limits", () => {
    const stop = { place: "TYO", minNights: 2, maxNights: 3 };
    expect(PlanRequestSchema.safeParse({ home: "AUS", stops: Array(5).fill(stop), reorder: true, startFrom: "2027-03-01", startTo: "2027-03-02" }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ home: "AUS", stops: [stop], startFrom: "2027-03-01", startTo: "2027-07-01" }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ home: "AUS", stops: [{ ...stop, minNights: 4 }], startFrom: "2027-03-01", startTo: "2027-03-02" }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ home: "AUS", stops: [stop], end: "place", startFrom: "2027-03-01", startTo: "2027-03-02" }).success).toBe(false);
  });
});
