import { describe, expect, it } from "vitest";
import { addDays, PlanRequestSchema, type PlanRequest } from "@farescope/shared";
import { buildApp } from "../app.ts";
import { QueryCache } from "../cache.ts";
import { loadConfig } from "../config.ts";
import { openDb } from "../db.ts";
import { QuotaGuard } from "../quota.ts";
import { createMockFlightProvider } from "../providers/mock.ts";
import type { CalendarQuery, FlightProvider } from "../providers/types.ts";
import { inject } from "../test-inject.ts";
import { planTrip } from "./plan.ts";

const NOW = new Date("2026-11-20T12:00:00Z");
const plan = (o: Partial<PlanRequest> = {}): PlanRequest => PlanRequestSchema.parse({
  home: "AUS",
  stops: [{ place: "city:Tokyo|JP", minNights: 3, maxNights: 4 }, { place: "city:Osaka|JP", minNights: 2, maxNights: 3 }, { place: "ICN", minNights: 2, maxNights: 2 }],
  ground: [{ a: 1, b: 2, cost: 100 }],
  startFrom: "2027-03-01", startTo: "2027-03-04",
  ...o,
});

/** A live provider with a one-way date grid: $300 + $10 per day, cheaper out of Osaka. */
function fakeGrid() {
  const calls: CalendarQuery[] = [];
  const provider: FlightProvider = {
    name: "fakegrid", live: true, maxAirportsPerSide: 7, calendarMaxDays: 121,
    search: async () => ({ fares: [] }),
    calendar: async (q) => {
      calls.push(q);
      const out = [];
      for (let d = q.rangeStart, i = 0; d <= q.rangeEnd; d = addDays(d, 1), i++) out.push({ departDate: d, price: 300 + 10 * i + (q.origins[0] === "KIX" ? -100 : 0) });
      return out;
    },
  };
  return { provider, calls };
}

function deps(provider: FlightProvider, budget = 50) {
  const db = openDb(":memory:");
  const quota = new QuotaGuard(db, { monthlyBudget: 1000, dailyClientBudget: budget }, () => NOW);
  return { db, quota, base: { provider, cache: new QueryCache(db, () => NOW.getTime()), quota, clientId: "ip:1", maxCredits: 20, now: () => NOW } };
}

describe("multi-stop plan pricing", () => {
  it("prices each flown leg with one one-way grid, reserves the credits once, and finds a plan", async () => {
    const { provider, calls } = fakeGrid();
    const { base, quota } = deps(provider);
    const r = await planTrip(plan(), base);
    // Flown legs: AUS->Tokyo, Osaka->Seoul, Seoul->AUS (Tokyo->Osaka is by train).
    expect(calls.map((q) => `${q.origins[0]}>${q.destinations[0]}`)).toEqual(["AUS>NRT", "KIX>ICN", "ICN>AUS"]);
    expect(calls.every((q) => q.nights === undefined)).toBe(true); // one-way grids
    expect(r.creditsUsed).toBe(3);
    expect(quota.remaining("ip:1")).toBe(47);
    expect(r.airports).toMatchObject({ 0: "AUS", 3: "ICN" });
    expect(r.result?.best?.legs.map((l) => l.mode)).toEqual(["fly", "ground", "fly", "fly"]);
    expect(r.result?.best?.start).toBe("2027-03-01");
    // Same plan again: all cached, no credits.
    const again = await planTrip(plan(), base);
    expect(again.creditsUsed).toBe(0);
    expect(calls).toHaveLength(3);
  });

  it("refuses plans that need more credits than are left or than one plan may use", async () => {
    const { provider, calls } = fakeGrid();
    expect((await planTrip(plan(), deps(provider, 2).base)).error).toMatch(/needs 3 credits/);
    expect((await planTrip(plan({ reorder: true }), { ...deps(provider).base, maxCredits: 5 })).error).toMatch(/more than the 5/);
    expect(calls).toHaveLength(0);
  });

  it("explains unknown places and works on the demo's simulated prices", async () => {
    const mock = createMockFlightProvider({ today: () => "2026-11-20" });
    const unknown = await planTrip(plan({ stops: [{ place: "Narnia", minNights: 2, maxNights: 3 }] }), deps(mock).base);
    expect(unknown.error).toMatch(/Narnia/);
    const demo = await planTrip(plan({ stops: [{ place: "NRT", minNights: 3, maxNights: 4 }, { place: "ICN", minNights: 2, maxNights: 3 }], ground: [] }), deps(mock).base);
    expect(demo.result?.best?.legs.map((l) => `${l.fromPlace}>${l.toPlace}`)).toEqual(["AUS>NRT", "NRT>ICN", "ICN>AUS"]);
    expect(demo.creditsUsed).toBe(0);
  });

  it("is served at POST /api/plan", async () => {
    const app = buildApp(loadConfig({ PROVIDER: "mock" } as NodeJS.ProcessEnv), { dbPath: ":memory:" });
    const ok = await inject(app, { method: "POST", url: "/api/plan", payload: { home: "AUS", stops: [{ place: "NRT", minNights: 3, maxNights: 4 }], startFrom: "2027-03-01", startTo: "2027-03-03" } });
    expect(ok.json().result.best.legs).toHaveLength(2);
    expect((await inject(app, { method: "POST", url: "/api/plan", payload: { home: "AUS", stops: [] } })).statusCode).toBe(400);
    // A planned trip saves with its legs and totals them.
    const best = ok.json().result.best;
    const legs = best.legs.map((l: { fromPlace: string; toPlace: string; date: string; price: number }) => ({ from: l.fromPlace, to: l.toPlace, date: l.date, mode: "fly", price: l.price }));
    const fare = { id: "f", provider: "plan", origin: "AUS", destination: "NRT", departDate: best.start, price: legs[0].price, currency: "USD", airlines: [], stops: 0, durationMin: 0, outbound: [], fetchedAt: "x", cached: true };
    const headers = { "x-client-id": "plan-test-client" };
    const saved = await inject(app, { method: "POST", url: "/api/trips", headers, payload: { name: "Tokyo", adults: 1, fare, legs } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().trip.total).toBe(best.total);
    expect(saved.json().trip.legs).toHaveLength(2);
    expect((await inject(app, { method: "POST", url: "/api/trips", headers, payload: { name: "Bad", fare, legs: [{ ...legs[0], price: -1 }] } })).statusCode).toBe(400);
  });
});
