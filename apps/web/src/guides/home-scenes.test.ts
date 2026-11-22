import { describe, expect, it } from "vitest";
import { cheapestCell, gridCells, gridMonths } from "./home-grid.ts";
import { homeScenes, MAX_TRIPS } from "./home-scenes.ts";

describe("homepage example searches", () => {
  const scenes = homeScenes("2026-11-22");

  it("count trips from the real place data, capped like the search", () => {
    const japan = scenes[0];
    expect(japan.route).toBe("Austin → anywhere in Japan");
    expect([japan.from, japan.to]).toEqual(["2027-01-01", "2027-04-30"]);
    // 1 origin × 8 Japanese airports × 120 days × 6 trip lengths.
    expect(japan.trips).toBe(8 * 120 * 6);
    expect(japan.capped).toBe(false);
    expect(scenes.find((s) => s.route === "New York → Europe")).toMatchObject({ trips: MAX_TRIPS, capped: true });
    for (const s of scenes) {
      expect(s.dests.length).toBeGreaterThan(5);
      expect(s.dests.some((d) => d.cheap)).toBe(true);
    }
  });

  it("lays the grid out by month and finds one cheapest cell", () => {
    const japan = scenes[0];
    expect(gridMonths(japan).map((m) => [m.label, m.days, m.offset])).toEqual([["Jan 2027", 31, 0], ["Feb 2027", 28, 31], ["Mar 2027", 31, 59], ["Apr 2027", 30, 90]]);
    const cells = gridCells(japan, 1);
    expect(cells).toHaveLength(120 * 6);
    expect(cells.every((c) => c.level >= 0 && c.level <= 1)).toBe(true);
    const best = cheapestCell(cells);
    expect(cells.filter((c) => c.level <= best.level)).toHaveLength(1);
  });
});
