import { describe, expect, it } from "vitest";
import {
  buildGuide,
  cToF,
  comfortScore,
  DESTINATIONS,
  demandScore,
  monthlyClimate,
  monthRanges,
  usPeak,
  type ClimateRaw,
  type Destination,
} from "./guides.ts";
import { resolvePlace } from "./places.ts";

const flat = (v: number) => Array.from({ length: 12 }, () => v);
/** A city with a hot, very wet monsoon in Jun–Sep and pleasant, dry winters. */
const monsoon: ClimateRaw = {
  period: "test",
  monthly: {
    T2M: [24, 25, 27, 29, 30, 29, 28, 28, 28, 27, 25, 24],
    T2M_RANGE: flat(8),
    PRECTOTCORR: [0.5, 0.5, 1, 2, 5, 9, 10, 10, 9, 4, 1, 0.5],
    RH2M: [60, 60, 65, 70, 75, 85, 88, 88, 86, 78, 70, 62],
  },
};
const dest: Destination = { slug: "test", name: "Testville", country: "XX", lat: 25, lng: 80, searchTo: "DEL" };

describe("climate", () => {
  it("derives typical highs/lows from mean ± half the daily range, and rain per month", () => {
    const c = monthlyClimate(monsoon);
    expect(c[0]).toMatchObject({ month: 1, highC: 28, lowC: 20, rainMm: 16, humidity: 60 });
    expect(c[6].rainMm).toBe(310); // 10 mm/day × 31 days
    expect(cToF(28)).toBe(82);
  });
});

describe("scoring", () => {
  it("scores a monsoon month far below a dry, mild month", () => {
    const c = monthlyClimate(monsoon);
    expect(comfortScore(c[0])).toBeGreaterThan(0.9);
    expect(comfortScore(c[6])).toBeLessThan(0.4);
  });

  it("raises demand for holidays, US breaks, events and winter-sun season", () => {
    const quiet = demandScore(10, 0.5, []);
    expect(demandScore(10, 0.5, [{ date: "2027-10-01", name: "A" }, { date: "2027-10-02", name: "B" }])).toBeGreaterThan(quiet);
    expect(demandScore(7, 0.5, [])).toBeGreaterThan(quiet);
    expect(demandScore(10, 0.5, [], { events: [{ months: [10], name: "Fest", when: "Oct", weight: 0.3 }] })).toBeCloseTo(quiet + 0.3, 5);
    expect(demandScore(1, 0.5, [], { winterSun: true })).toBeGreaterThan(demandScore(1, 0.5, []));
    expect(usPeak(7)?.label).toBe("US summer break");
    expect(usPeak(10)).toBeUndefined();
  });
});

describe("buildGuide", () => {
  const g = buildGuide(dest, monsoon, [{ date: "2027-01-26", name: "Republic Day" }]);

  it("labels every month and picks best-value months from the dry season, not the monsoon", () => {
    expect(g.months).toHaveLength(12);
    expect(g.best.length).toBeGreaterThan(0);
    for (const m of g.best) expect([10, 11, 12, 1, 2, 3, 4]).toContain(m);
    // September: monsoon rain and no extra demand → off-season. July is just as wet but US summer
    // travel keeps it busy, so it's "shoulder", not "off".
    expect(g.months[8].label).toBe("Off-season");
    expect(g.months[6].label).toBe("Shoulder season");
  });

  it("writes notes from the month's own numbers", () => {
    const jul = g.months[6];
    expect(jul.notes[0]).toContain(`${cToF(jul.climate.highC)}°F`);
    expect(jul.notes.join(" ")).toMatch(/310 mm \(12\.2 in\) of rain, (the|one of the) rainiest/);
    expect(jul.notes.join(" ")).toContain("US summer break");
    expect(g.months[0].notes.join(" ")).toContain("Republic Day (Jan 26)");
    expect(g.summary).toMatch(/^Best value: /);
  });

  it("doesn't claim there are no holidays when the country has no holiday data", () => {
    const none = buildGuide(dest, monsoon, null);
    expect(none.holidayData).toBe(false);
    expect(none.months.flatMap((m) => m.notes).join(" ")).not.toContain("No nationwide public holidays");
  });

  it("treats a famous festival month as peak, not best value", () => {
    const withFest = buildGuide({ ...dest, events: [{ months: [1, 2], name: "Big Fest", when: "Jan–Feb", weight: 0.4 }] }, monsoon, []);
    expect(withFest.best).not.toContain(1);
    expect(withFest.months[0].notes.join(" ")).toContain("Big Fest (Jan–Feb) draws big crowds");
  });
});

describe("summary when no month is good value", () => {
  it("names the most pleasant month and says it's peak season instead of calling it best value", () => {
    // A cold, wet place whose only mild month (July) falls in the US summer peak.
    const cold: ClimateRaw = {
      monthly: {
        T2M: [0, 0, 1, 3, 7, 10, 13, 11, 8, 4, 1, 0],
        T2M_RANGE: flat(6),
        PRECTOTCORR: flat(4),
        RH2M: flat(80),
      },
    };
    const g = buildGuide({ ...dest, lat: 64 }, cold, []);
    expect(g.summary).toMatch(/^Most pleasant: Jul/);
    expect(g.summary).toContain("No month combines good weather with low demand");
    expect(g.summary).not.toContain("Best value");
  });
});

describe("monthRanges", () => {
  it("formats month lists compactly, wrapping December into January", () => {
    expect(monthRanges([9, 10, 11])).toBe("Sep–Nov");
    expect(monthRanges([4, 10])).toBe("Apr and Oct");
    expect(monthRanges([12, 1, 2])).toBe("Dec–Feb");
    expect(monthRanges([5, 9, 10])).toBe("May and Sep–Oct");
  });
});

describe("destinations", () => {
  it("are unique and every search target resolves to airports", () => {
    expect(new Set(DESTINATIONS.map((d) => d.slug)).size).toBe(DESTINATIONS.length);
    for (const d of DESTINATIONS) expect(resolvePlace(d.searchTo)?.airports.length, d.slug).toBeGreaterThan(0);
  });
});
