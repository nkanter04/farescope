import { describe, expect, it } from "vitest";
import type { Fare } from "@farescope/shared";
import { QueryCache } from "../cache.ts";
import { openDb } from "../db.ts";
import { QuotaGuard } from "../quota.ts";
import { createMockFlightProvider } from "../providers/mock.ts";
import type { FlightProvider, FlightQuery } from "../providers/types.ts";
import { fareDetails } from "./details.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const priceOnly: Fare = {
  id: "cal-AUS-NRTHND-2027-03-02-2027-03-09", provider: "fake", origin: "AUS", destination: "NRT", departDate: "2027-03-02", returnDate: "2027-03-09",
  price: 1043, currency: "USD", airlines: [], stops: 0, durationMin: 0, outbound: [], fetchedAt: NOW.toISOString(), cached: false,
  priceOnly: true, coverage: { origins: ["AUS"], destinations: ["NRT", "HND"] },
};

function setup(monthly = 10) {
  const inner = createMockFlightProvider({ today: () => "2026-11-16" });
  const calls: FlightQuery[] = [];
  const provider: FlightProvider = { name: "fake", live: true, maxAirportsPerSide: 7, search: async (q) => (calls.push(q), inner.search(q)) };
  const db = openDb(":memory:");
  const deps = {
    provider,
    cache: new QueryCache(db, () => NOW.getTime()),
    quota: new QuotaGuard(db, { monthlyBudget: monthly, dailyClientBudget: 10 }, () => NOW),
    clientId: "t",
    now: () => NOW,
  };
  return { calls, deps };
}

describe("fareDetails", () => {
  it("searches the price's whole airport coverage on its exact dates, then serves the cache", async () => {
    const { calls, deps } = setup();
    const first = await fareDetails({ fare: priceOnly, cabin: "economy", maxStops: null, adults: 1 }, deps);
    expect(calls[0]).toMatchObject({ origins: ["AUS"], destinations: ["NRT", "HND"], departDate: "2027-03-02", returnDate: "2027-03-09" });
    expect(first.fares.length).toBeGreaterThan(0);
    expect(first.fares.every((f) => !f.priceOnly && f.outbound.length > 0)).toBe(true);
    const again = await fareDetails({ fare: priceOnly, cabin: "economy", maxStops: null, adults: 1 }, deps);
    expect(calls).toHaveLength(1);
    expect(again).toMatchObject({ cached: true });
  });

  it("reports a used-up budget instead of calling the provider", async () => {
    const { calls, deps } = setup(0);
    const r = await fareDetails({ fare: priceOnly, cabin: "economy", maxStops: null, adults: 1 }, deps);
    expect(calls).toHaveLength(0);
    expect(r.error).toMatch(/budget/);
  });
});
