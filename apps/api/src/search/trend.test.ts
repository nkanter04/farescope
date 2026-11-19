import { describe, expect, it } from "vitest";
import { addDays, type Fare } from "@farescope/shared";
import { QueryCache } from "../cache.ts";
import { PriceHistory } from "../history.ts";
import { openDb } from "../db.ts";
import { QuotaGuard } from "../quota.ts";
import { createMockFlightProvider, mockPriceHistory } from "../providers/mock.ts";
import { flightQueryKey, type FlightProvider, type FlightQuery } from "../providers/types.ts";
import { buildPriceTrend } from "./trend.ts";
import { checkWatch, matchFare, newWatch, WATCH_RECHECK_MS } from "./watch.ts";

const TODAY = "2026-11-18";
const NOW = new Date(`${TODAY}T12:00:00Z`);
const query: FlightQuery = {
  origins: ["AUS"], destinations: ["NRT", "HND", "KIX"], departDate: "2027-03-10", returnDate: "2027-03-18",
  cabin: "economy", maxStops: null, adults: 1,
};

async function mockFares(today = TODAY) {
  return (await createMockFlightProvider({ today: () => today }).search(query)).fares;
}

it("isolates observations by cabin and party and ignores legacy unscoped rows", async () => {
  const [fare] = await mockFares();
  const db = openDb(":memory:");
  const cache = new QueryCache(db, () => NOW.getTime());
  const history = new PriceHistory(db);
  const economy = flightQueryKey("serpapi", query);
  const business = flightQueryKey("serpapi", { ...query, cabin: "business", adults: 2 });
  cache.recordPrices([{ ...fare, price: 500 }], "economy", economy);
  cache.recordPrices([{ ...fare, price: 4000 }], "business", business);
  expect(history.forFare({ ...fare, queryKey: business })).toEqual([{ date: TODAY, price: 4000 }]);
  expect(history.forFare({ ...fare, queryKey: undefined })).toEqual([]);
  db.close();
});

describe("mock price history", () => {
  it("is deterministic, covers the whole on-sale window and stays near today's price", async () => {
    const [fare] = await mockFares();
    const a = mockPriceHistory(fare, TODAY);
    expect(a).toEqual(mockPriceHistory(fare, TODAY));
    // Departs 2027-03-10, 112 days after TODAY: on sale since 330 days before departure.
    expect(a).toHaveLength(330 - 112);
    expect(a[0].date).toBe(addDays(fare.departDate, -330));
    expect(a.at(-1)!.date).toBe(addDays(TODAY, -1));
    expect(mockPriceHistory(fare, TODAY, 60)).toHaveLength(60);
    for (const p of a) expect(p.price / fare.price).toBeGreaterThan(0.75);
  });
});

describe("buildPriceTrend", () => {
  it("forecasts a demo fare from simulated history, learning the curve from other flights", async () => {
    const fares = await mockFares();
    const provider = createMockFlightProvider({ today: () => TODAY });
    const cache = new QueryCache(openDb(":memory:"));
    const trend = buildPriceTrend(fares[0], fares, { provider, cache, now: () => NOW });
    expect(trend.history).toHaveLength(330 - 112 + 1);
    expect(trend.history.at(-1)).toEqual({ date: TODAY, price: fares[0].price });
    expect(trend.forecast.at(-1)!.date).toBe(fares[0].departDate);
    expect(trend.basis.simulated).toBe(true);
    expect(trend.basis.curveSeries).toBeGreaterThan(0);
    expect(trend.basis.curveSeries).toBeLessThan(fares.length); // excludes the fare itself
    expect(["book", "wait", "steady"]).toContain(trend.verdict);
  });

  it("uses Google's search-level price history for live fares, scaled to the fare", () => {
    const db = openDb(":memory:");
    const cache = new QueryCache(db, () => NOW.getTime());
    const live: FlightProvider = { name: "fakelive", live: true, maxAirportsPerSide: 7, search: async () => ({ fares: [] }) };
    const key = flightQueryKey("fakelive", query);
    const history = Array.from({ length: 20 }, (_, i) => ({ date: addDays(TODAY, -20 + i), price: 900 + (20 - i) * 10 }));
    cache.put(key, "fakelive", { fares: [], insights: { history } }, 3_600_000);
    const fare = { origin: "AUS", destination: "NRT", departDate: "2027-03-10", returnDate: "2027-03-18", price: 1100, queryKey: key } as Fare;
    const trend = buildPriceTrend(fare, [], { provider: live, cache, now: () => NOW });
    expect(trend.history).toHaveLength(21);
    // Scaled so the most recent Google day (910) matches this fare's price (1100).
    expect(trend.history.at(-2)!.price).toBe(1100);
    expect(trend.history[0].price).toBe(Math.round(1100 * (1100 / 910)));
    expect(trend.basis.simulated).toBe(false);
  });
});

describe("price watches", () => {
  const quota = (budget: number) => new QuotaGuard(openDb(":memory:"), { monthlyBudget: budget, dailyClientBudget: budget }, () => NOW);

  it("re-prices a demo watch as days pass, without spending quota", async () => {
    const [fare] = await mockFares(TODAY);
    const watch = newWatch(fare, "economy", 1, "w1", NOW);
    const later = new Date(NOW.getTime() + 20 * 86_400_000);
    const provider = createMockFlightProvider({ today: () => "2026-12-08" });
    const r = await checkWatch(watch, { provider, cache: new QueryCache(openDb(":memory:")), quota: quota(0), clientId: "c", now: () => later });
    expect(r).toMatchObject({ checked: true, units: 0 });
    expect(r.watch.lastPrice).toBeGreaterThan(0);
    expect(r.watch.checks.at(-1)!.date).toBe("2026-12-08");
    expect(r.watch.priceAtWatch).toBe(fare.price);
  });

  it("spends one quota unit per live check, waits between checks, and holds when the budget is gone", async () => {
    const [fare] = await mockFares();
    const inner = createMockFlightProvider({ today: () => TODAY });
    let calls = 0;
    const live: FlightProvider = { ...inner, name: "fakelive", live: true, priceHistory: undefined, search: (q) => (calls++, inner.search(q)) };
    const db = openDb(":memory:");
    const cache = new QueryCache(db, () => NOW.getTime());
    const guard = new QuotaGuard(db, { monthlyBudget: 1, dailyClientBudget: 1 }, () => NOW);
    const old = { ...newWatch(fare, "economy", 1, "w2", NOW), lastChecked: new Date(NOW.getTime() - WATCH_RECHECK_MS - 1).toISOString() };

    const first = await checkWatch(old, { provider: live, cache, quota: guard, clientId: "c", now: () => NOW });
    expect(first).toMatchObject({ checked: true, units: 1 });
    expect(guard.status("c").monthlyUsed).toBe(1);

    // Checked just now: skipped without a call.
    const again = await checkWatch(first.watch, { provider: live, cache, quota: guard, clientId: "c", now: () => NOW });
    expect(again).toMatchObject({ checked: false, units: 0 });

    // A different flight, budget used up: watch is left unchanged.
    const other = { ...old, id: "w3", fare: { ...fare, returnDate: "2027-03-20" } };
    const held = await checkWatch(other, { provider: live, cache, quota: guard, clientId: "c", now: () => NOW });
    expect(held).toMatchObject({ checked: false, units: 0, watch: other });
    expect(calls).toBe(1);
  });

  it("marks departed flights and matches the same itinerary first", async () => {
    const fares = await mockFares();
    const departed = newWatch({ ...fares[0], departDate: "2026-11-01" }, "economy", 1, "w4", NOW);
    const r = await checkWatch(departed, { provider: createMockFlightProvider(), cache: new QueryCache(openDb(":memory:")), quota: quota(5), clientId: "c", now: () => NOW });
    expect(r.watch.status).toBe("departed");
    const target = fares[fares.length - 1];
    expect(matchFare(target, fares)).toBe(target);
    expect(matchFare({ ...target, airlines: ["Nobody"] }, fares)).toBeUndefined();
  });
});
