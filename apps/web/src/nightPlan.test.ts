import { describe, expect, it } from "vitest";
import { initialNightRows, previewNightPlan } from "./nightPlan.ts";

const kyoto = { id: "k", place: "Kyoto", checkIn: "2028-03-01", checkOut: "2028-03-04", ownCost: 300 };
const tokyo = { id: "t", place: "Tokyo", checkIn: "2028-02-28", checkOut: "2028-03-01", ownCost: 0 };
const stops = [kyoto, tokyo];
describe("planning consecutive overnight stops", () => {
  it("sorts existing stops and preserves unchanged bookings across leap day", () => {
    expect(previewNightPlan(tokyo.checkIn, initialNightRows(stops), stops)).toEqual([tokyo, kyoto]);
  });
  it("recalculates downstream dates and drops costs tied to changed dates", () => {
    const rows = initialNightRows(stops);
    rows[0].nights = "3";
    const plan = previewNightPlan(tokyo.checkIn, rows, stops);
    expect(plan[1]).toEqual({ id: "k", place: "Kyoto", checkIn: "2028-03-02", checkOut: "2028-03-05" });
    expect(plan[0]).not.toHaveProperty("ownCost");
  });
  it("leaves later dates unknown after an incomplete duration", () => {
    const rows = initialNightRows(stops);
    rows[0].nights = "";
    expect(previewNightPlan(tokyo.checkIn, rows, stops)[1].checkOut).toBe("");
  });
});
