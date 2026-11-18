import { describe, expect, it } from "vitest";
import { addDays } from "./dates.ts";
import {
  PRIOR_BOOKING_CURVE,
  PRIOR_CURVE,
  curveAt,
  curveBin,
  forecastFare,
  learnBookingCurve,
  type BookingCurve,
  type CurveSeries,
} from "./forecast.ts";

const TODAY = "2027-01-01";

/** A synthetic "true" curve that differs from the prior, to check the learner finds it. */
const TRUE = [1.7, 1.3, 1.12, 0.96, 0.9, 1.0, 1.15];

function series(departDate: string, level: number, curve: number[], from = 0, to = 300, step = 3): CurveSeries {
  const points = [];
  for (let d = to; d >= from; d -= step) points.push({ date: addDays(departDate, -d), price: level * curve[curveBin(d)] });
  return { departDate, points };
}

describe("booking curve", () => {
  it("falls back to the prior with no data", () => {
    const c = learnBookingCurve([]);
    expect(c.multipliers).toEqual(PRIOR_CURVE);
    expect(c.series).toBe(0);
  });

  it("learns the shape of previous flights' price curves", () => {
    const data = Array.from({ length: 80 }, (_, i) => series(addDays("2027-06-01", i), 300 + i * 7, TRUE));
    const c = learnBookingCurve(data);
    expect(c.series).toBe(80);
    // Compare shape (relative to the 21–44 day bin), not absolute scale.
    for (let i = 0; i < TRUE.length; i++) {
      expect(c.multipliers[i] / c.multipliers[3]).toBeCloseTo(TRUE[i] / TRUE[3], 1);
    }
  });

  it("combines series that cover different windows", () => {
    const near = Array.from({ length: 60 }, (_, i) => series(addDays("2027-06-01", i), 400, TRUE, 0, 60, 2));
    const far = Array.from({ length: 60 }, (_, i) => series(addDays("2027-08-01", i), 900, TRUE, 30, 300, 5));
    const c = learnBookingCurve([...near, ...far]);
    expect(c.multipliers[0]).toBeGreaterThan(c.multipliers[3] * 1.4); // last week is much pricier
    expect(c.multipliers[4]).toBeLessThan(c.multipliers[3]); // 45–89 days is the cheapest window
  });

  it("interpolates smoothly between bins", () => {
    const a = curveAt(PRIOR_BOOKING_CURVE, 20);
    const b = curveAt(PRIOR_BOOKING_CURVE, 22);
    expect(Math.abs(a - b)).toBeLessThan(0.02);
  });
});

describe("forecastFare", () => {
  const depart = addDays(TODAY, 120);
  const curve: BookingCurve = { multipliers: TRUE, observations: TRUE.map(() => 50), series: 40 };
  const history = (level: number) =>
    Array.from({ length: 60 }, (_, i) => {
      const date = addDays(TODAY, -60 + i);
      return { date, price: Math.round(level * curveAt(curve, 120 + 60 - i)) };
    });

  it("predicts a dip toward the cheap window and says to wait when it's well below today", () => {
    // 120 days out, the cheapest window (45–89 days) is still ahead.
    const t = forecastFare({ price: 520, today: TODAY, departDate: depart, history: history(500), curve });
    expect(t.forecast).toHaveLength(120);
    expect(t.forecast.at(-1)!.date).toBe(depart);
    expect(t.lowest.price).toBeLessThan(520 * 0.92);
    expect(t.verdict).toBe("wait");
    const lowDays = 120 - (new Date(t.lowest.date).getTime() - new Date(TODAY).getTime()) / 86_400_000;
    expect(lowDays).toBeGreaterThanOrEqual(30);
    expect(lowDays).toBeLessThanOrEqual(90);
    // Last-minute prices climb.
    expect(t.forecast.at(-1)!.price).toBeGreaterThan(t.lowest.price * 1.4);
  });

  it("says it's a good time to book when nothing cheaper is expected", () => {
    const soon = addDays(TODAY, 30); // already past the cheap window
    const h = Array.from({ length: 40 }, (_, i) => ({ date: addDays(TODAY, -40 + i), price: 400 }));
    const t = forecastFare({ price: 380, today: TODAY, departDate: soon, history: h, curve });
    expect(t.verdict).toBe("book");
    expect(t.lowest).toEqual({ date: TODAY, price: 380 });
    expect(t.level).toBe("low");
  });

  it("widens the uncertainty band with time and keeps today's price as the anchor", () => {
    const t = forecastFare({ price: 520, today: TODAY, departDate: depart, history: history(500), curve });
    const width = (i: number) => t.forecast[i].high / t.forecast[i].low;
    expect(width(60)).toBeGreaterThan(width(2));
    expect(Math.abs(t.forecast[0].price - 520) / 520).toBeLessThan(0.08);
    expect(t.history.at(-1)).toEqual({ date: TODAY, price: 520 });
    expect(t.basis).toMatchObject({ historyPoints: 61, curveSeries: 40 });
  });

  it("ignores future-dated history and handles departure today", () => {
    const t = forecastFare({ price: 300, today: TODAY, departDate: TODAY, history: [{ date: "2027-02-01", price: 1 }], curve });
    expect(t.forecast).toEqual([]);
    expect(t.verdict).toBe("book");
    expect(t.history).toEqual([{ date: TODAY, price: 300 }]);
  });
});
