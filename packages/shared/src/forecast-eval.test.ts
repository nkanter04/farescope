import { describe, expect, it } from "vitest";
import { addDays } from "./dates.ts";
import { backtestForecasts, formatBacktest } from "./forecast-eval.ts";
import { curveBin, type CurveSeries } from "./forecast.ts";

/** Flights whose prices follow a booking curve plus small deterministic noise. */
function synthetic(count: number, curve = [1.6, 1.3, 1.12, 0.98, 0.92, 0.98, 1.1]): CurveSeries[] {
  return Array.from({ length: count }, (_, i) => {
    const departDate = addDays("2026-03-01", i * 3);
    const level = 300 + (i % 17) * 40;
    const points = [];
    for (let d = 300; d >= 0; d--) {
      const noise = 1 + 0.03 * Math.sin(d / 5 + i) + 0.01 * Math.sin(d * 1.7 + i * 3);
      points.push({ date: addDays(departDate, -d), price: Math.round(level * curve[curveBin(d)] * noise) });
    }
    return { departDate, points };
  });
}

describe("backtestForecasts", () => {
  const report = backtestForecasts(synthetic(60));

  it("scores predictions at each horizon without using future data", () => {
    expect(report.flights).toBe(60);
    expect(report.predictions).toBeGreaterThan(1000);
    for (const h of report.horizons) expect(h.n).toBeGreaterThan(500);
  });

  it("beats 'price stays the same' when prices follow a booking curve", () => {
    const month = report.horizons.find((h) => h.days === 30)!;
    expect(month.mape).toBeLessThan(month.naiveMape * 0.8);
    expect(report.verdicts.wait.n + report.verdicts.book.n).toBeGreaterThan(0);
    expect(report.lowestMape).toBeLessThan(0.15);
  });

  it("formats a readable summary", () => {
    const text = formatBacktest(report);
    expect(text).toMatch(/Forecast error/);
    expect(text).toMatch(/ 30 days/);
  });

  it("skips flights without enough history", () => {
    const short = [{ departDate: "2026-05-01", points: [{ date: "2026-04-01", price: 100 }] }];
    expect(backtestForecasts(short)).toMatchObject({ flights: 0, predictions: 0 });
  });
});
