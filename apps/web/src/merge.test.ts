import { describe, expect, it } from "vitest";
import type { Fare } from "@farescope/shared";
import { mergeFares, supersedes } from "./store.ts";

const base: Fare = {
  id: "x", provider: "serpapi", origin: "AUS", destination: "NRT", departDate: "2027-03-02", returnDate: "2027-03-09", price: 1000,
  currency: "USD", airlines: ["ANA"], stops: 1, durationMin: 900, outbound: [], fetchedAt: "", cached: false,
};
const grid: Fare = { ...base, id: "cal", airlines: [], priceOnly: true, coverage: { origins: ["AUS"], destinations: ["NRT", "HND"] } };

describe("mergeFares", () => {
  it("replaces a date-grid price once a real itinerary for the same trip arrives", () => {
    const full = { ...base, id: "full", destination: "HND", price: 1012 };
    expect(supersedes(full, grid)).toBe(true);
    expect(supersedes({ ...full, departDate: "2027-03-03" }, grid)).toBe(false);
    expect(supersedes({ ...full, destination: "KIX" }, grid)).toBe(false);
    expect(mergeFares([grid], [full]).map((f) => f.id)).toEqual(["full"]);
    expect(mergeFares([full], [grid]).map((f) => f.id)).toEqual(["full"]); // late grid price is not re-added
    expect(mergeFares([grid], [{ ...grid, id: "cal2", departDate: "2027-03-05" }])).toHaveLength(2);
    const japan = { ...grid, id: "jp", queryKey: "f|serpapi|AUS|/m/03_3d|2027-03-02", coverage: { origins: ["AUS"], destinations: ["/m/03_3d"], destinationLabel: "Japan" } };
    expect(supersedes({ ...full, destination: "KIX", queryKey: japan.queryKey }, japan)).toBe(true);
    expect(supersedes({ ...full, destination: "KIX", queryKey: "other" }, japan)).toBe(false);
  });
});
