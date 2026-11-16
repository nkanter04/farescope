import { describe, expect, it } from "vitest";
import { SearchRequestSchema, type Fare, type SearchEvent } from "@farescope/shared";
import { QueryCache, ttlFor } from "../cache.ts";
import { openDb } from "../db.ts";
import { QuotaGuard } from "../quota.ts";
import { createMockFlightProvider } from "../providers/mock.ts";
import type { FlightProvider, FlightQuery } from "../providers/types.ts";
import { planSearch, refineCandidates, sampleCandidates, spread } from "./planner.ts";
import { runSearch } from "./run.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const TODAY = "2026-11-16";

const req = SearchRequestSchema.parse({
  origins: ["AUS"],
  destinations: ["Japan"],
  departFrom: "2027-03-01",
  departTo: "2027-03-31",
  tripType: "roundtrip",
  minNights: 7,
  maxNights: 10,
});

describe("planner", () => {
  it("expands places x dates x trip lengths", () => {
    const plan = planSearch(req, { name: "mock", maxAirportsPerSide: 50 }, TODAY);
    expect(plan.routeGroups).toBe(1);
    expect(plan.candidates).toHaveLength(31 * 4);
    expect(plan.destinationAirports).toContain("NRT");
    const c = plan.candidates[0].query;
    expect([c.departDate, c.returnDate]).toEqual(["2027-03-01", "2027-03-08"]);
  });

  it("chunks airports to the provider's per-call limit", () => {
    const plan = planSearch({ ...req, destinations: ["Asia"], tripType: "oneway" }, { name: "x", maxAirportsPerSide: 7 }, TODAY);
    const asia = plan.destinationAirports.length;
    expect(plan.routeGroups).toBe(Math.ceil(asia / 7));
    expect(plan.candidates.every((c) => c.query.destinations.length <= 7)).toBe(true);
  });

  it("drops past dates and reports unknown places", () => {
    const plan = planSearch({ ...req, departFrom: "2026-11-01", departTo: "2026-11-17", destinations: ["Japan", "Narnia"] }, { name: "m", maxAirportsPerSide: 50 }, TODAY);
    expect(new Set(plan.candidates.map((c) => c.query.departDate))).toEqual(new Set(["2026-11-16", "2026-11-17"]));
    expect(plan.unknown).toEqual(["Narnia"]);
  });

  it("spreads samples across the window and route groups", () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([1, 5, 9]);
    const plan = planSearch(req, { name: "mock", maxAirportsPerSide: 50 }, TODAY);
    const s = sampleCandidates(plan.candidates, 4);
    expect(s).toHaveLength(4);
    expect(new Set(s.map((c) => c.nights))).toEqual(new Set([9])); // middle trip length first
    expect(s[0].query.departDate).toBe("2027-03-01");
    expect(s[3].query.departDate).toBe("2027-03-31");
  });

  it("refines around the cheapest result", () => {
    const plan = planSearch(req, { name: "mock", maxAirportsPerSide: 50 }, TODAY);
    const tried = new Set<string>();
    const r = refineCandidates(plan.candidates, tried, [{ routeGroup: 0, departDate: "2027-03-15", nights: 8 }], 3);
    expect(r[0].query.departDate).toBe("2027-03-15");
    expect(r[0].nights).toBe(8);
    expect(r.every((c) => Math.abs(Number(c.query.departDate.slice(8)) - 15) <= 1)).toBe(true);
  });
});

describe("cache and quota", () => {
  it("uses shorter TTLs close to departure", () => {
    expect(ttlFor("2026-11-20", NOW)).toBeLessThan(ttlFor("2027-01-10", NOW));
    expect(ttlFor("2027-01-10", NOW)).toBeLessThan(ttlFor("2027-06-01", NOW));
  });

  it("expires entries", () => {
    let t = 1_000;
    const cache = new QueryCache(openDb(":memory:"), () => t);
    cache.put("k", "p", { a: 1 }, 500);
    expect(cache.get("k")).toMatchObject({ value: { a: 1 }, expired: false });
    t = 2_000;
    expect(cache.get("k")?.expired).toBe(true);
  });

  it("enforces monthly and daily budgets", () => {
    const q = new QuotaGuard(openDb(":memory:"), { monthlyBudget: 3, dailyClientBudget: 2 }, () => NOW);
    expect(q.tryConsume("a")).toEqual({ ok: true });
    expect(q.tryConsume("a")).toEqual({ ok: true });
    expect(q.tryConsume("a")).toEqual({ ok: false, reason: "daily" });
    expect(q.tryConsume("b")).toEqual({ ok: true });
    expect(q.tryConsume("c")).toEqual({ ok: false, reason: "monthly" });
    expect(q.status("a")).toMatchObject({ monthlyUsed: 3, dailyClientUsed: 2 });
  });
});

/** A "live" provider backed by the mock, counting calls, to test budget behaviour. */
function fakeLive(): FlightProvider & { calls: FlightQuery[] } {
  const inner = createMockFlightProvider({ today: () => TODAY });
  const calls: FlightQuery[] = [];
  return { name: "fakelive", live: true, maxAirportsPerSide: 7, calls, search: async (q) => (calls.push(q), inner.search(q)) };
}

async function collect(provider: FlightProvider, opts: { perSearch: number; monthly?: number; db?: ReturnType<typeof openDb> }) {
  const db = opts.db ?? openDb(":memory:");
  const events: SearchEvent[] = [];
  await runSearch(
    req,
    {
      provider,
      cache: new QueryCache(db, () => NOW.getTime()),
      quota: new QuotaGuard(db, { monthlyBudget: opts.monthly ?? 100, dailyClientBudget: 100 }, () => NOW),
      clientId: "ip:test",
      perSearchBudget: opts.perSearch,
      freeCallCap: 1000,
      now: () => NOW,
    },
    (e) => events.push(e),
  );
  return { events, db, fares: events.filter((e) => e.type === "fare").map((e) => (e as { fare: Fare }).fare) };
}

describe("runSearch", () => {
  it("covers every candidate with a free provider", async () => {
    const { events, fares } = await collect(createMockFlightProvider({ today: () => TODAY }), { perSearch: 0 });
    const done = events.find((e) => e.type === "done")!;
    expect(done).toMatchObject({ providerCalls: 124 });
    const cells = new Set(fares.map((f) => `${f.departDate}|${f.returnDate}`));
    expect(cells.size).toBe(124); // one calendar cell per date pair
  });

  it("never exceeds the per-search budget with a live provider", async () => {
    const p = fakeLive();
    const { events } = await collect(p, { perSearch: 6 });
    expect(p.calls).toHaveLength(6);
    expect(events.find((e) => e.type === "done")).toMatchObject({ providerCalls: 6 });
  });

  it("serves the cache on repeat searches without new calls", async () => {
    const p = fakeLive();
    const first = await collect(p, { perSearch: 6 });
    const callsAfterFirst = p.calls.length;
    const second = await collect(p, { perSearch: 6, db: first.db });
    // second search: 6 cache hits plus at most 6 new calls
    expect(second.events.find((e) => e.type === "done")).toMatchObject({ cacheHits: 6 });
    expect(p.calls.length - callsAfterFirst).toBeLessThanOrEqual(6);
  });

  it("falls back to cache and warns when the monthly budget is gone", async () => {
    const p = fakeLive();
    const { events } = await collect(p, { perSearch: 6, monthly: 0 });
    expect(p.calls).toHaveLength(0);
    expect(events.some((e) => e.type === "notice" && e.level === "warn")).toBe(true);
  });
});
