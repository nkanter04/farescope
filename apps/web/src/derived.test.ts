import { describe, expect, it } from "vitest";
import type { Fare } from "@farescope/shared";
import { compareFares } from "./derived.ts";

const leg = { from: "AUS", to: "NRT", depart: "2027-02-02 06:30", arrive: "2027-02-03 15:00", airline: "Demo", flightNumber: "1", durationMin: 0 };
const fare = (id: string, price: number, durationMin: number, stops: number, priceOnly = false): Fare => ({
  id, provider: "test", origin: "AUS", destination: "NRT", departDate: "2027-02-02", price, currency: "USD", airlines: priceOnly ? [] : ["Demo"],
  stops, durationMin, outbound: priceOnly ? [] : [leg], fetchedAt: "", cached: false, priceOnly: priceOnly || undefined,
});

describe("result sorting", () => {
  const long = fare("long", 500, 1200, 2);
  const short = fare("short", 900, 800, 0);
  const grid = fare("grid", 400, 0, 0, true);
  const order = (sort: "price" | "duration" | "stops") => [grid, long, short].sort(compareFares(sort)).map((f) => f.id);

  it("sorts by price, including date-grid prices", () => {
    expect(order("price")).toEqual(["grid", "long", "short"]);
  });

  it("puts fares without flight details last when sorting by time or stops", () => {
    expect(order("duration")).toEqual(["short", "long", "grid"]);
    expect(order("stops")).toEqual(["short", "long", "grid"]);
  });

  it("breaks ties by price, and orders unknown fares cheapest first", () => {
    const grid2 = fare("grid2", 350, 0, 0, true);
    const nonstop2 = fare("nonstop2", 700, 900, 0);
    expect([grid, short, grid2, nonstop2].sort(compareFares("stops")).map((f) => f.id)).toEqual(["nonstop2", "short", "grid2", "grid"]);
  });
});
