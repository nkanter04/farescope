import { describe, expect, it } from "vitest";
import { addDays, SearchRequestSchema, type Fare, type SearchEvent } from "@farescope/shared";
import { QueryCache, ttlFor } from "../cache.ts";
import { openDb } from "../db.ts";
import { QuotaGuard } from "../quota.ts";
import { createMockFlightProvider, createMockStayProvider } from "../providers/mock.ts";
import { stayQueryKey, type CalendarPrice, type CalendarQuery, type ExploreQuery, type FlightProvider, type FlightQuery, type StayProvider } from "../providers/types.ts";
import { lookupStays } from "./stays.ts";
import { planSearch, refineCandidates, sampleCandidates, spread } from "./planner.ts";
import { calendarJobCount, planCalendar, planCalendarRoutes, planExplore, runSearch } from "./run.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const TODAY = "2026-11-16";

const req = SearchRequestSchema.parse({
  origins: ["AUS"],
  destinations: ["NRT", "HND", "KIX"],
  departFrom: "2027-03-01",
  departTo: "2027-03-31",
  tripType: "roundtrip",
  minNights: 7,
  maxNights: 10,
});

describe("planner", () => {
  it("bounds the work list for global searches while retaining its full size", () => {
    // 7 airports per call (SerpApi's chunk size) keeps anywhere x anywhere well above the cap.
    const plan = planSearch({ ...req, origins: ["anywhere"], destinations: ["anywhere"] },
      { name: "mock", maxAirportsPerSide: 7 }, TODAY);
    expect(plan.candidates).toHaveLength(40_000);
    expect(plan.totalCandidates).toBeGreaterThan(40_000);
    expect(new Set(plan.candidates.map(candidate => candidate.key)).size).toBe(40_000);
  });
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

async function collect(provider: FlightProvider, opts: { perSearch: number; monthly?: number; db?: ReturnType<typeof openDb>;
  stays?: StayProvider; request?: typeof req }) {
  const db = opts.db ?? openDb(":memory:");
  const events: SearchEvent[] = [];
  await runSearch(
    opts.request ?? req,
    {
      provider,
      stays: opts.stays,
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
  it("ranks distinct flight and stay options by combined price for the submitted party", async () => {
    const provider = createMockStayProvider();
    const { events } = await collect(createMockFlightProvider({ today: () => TODAY }), {
      perSearch: 0, stays: provider, request: { ...req, adults: 3 },
    });
    const shortlist = events.filter(e => e.type === "shortlist").at(-1)!;
    expect(shortlist.checked).toBe(4);
    expect(shortlist.eligible).toBeGreaterThan(4);
    expect(shortlist.quotes).toHaveLength(4);
    const totals = shortlist.quotes.map(({ fare, stay }) => fare.price + stay.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    const keys = new Set<string>();
    for (const { fare, stay } of shortlist.quotes) {
      expect(stay.checkIn).toBe(fare.outbound.at(-1)?.arrive.slice(0, 10));
      expect(stay.checkOut).toBe(fare.returnDate);
      const query = { airport: fare.destination, checkIn: stay.checkIn, checkOut: stay.checkOut, adults: 3 };
      keys.add(stayQueryKey(provider.name, query));
      expect(stay.total).toBe(Math.min(...(await provider.search(query)).map(s => s.total)));
    }
    expect(keys.size).toBe(4);
  });

  it("charges flights and multi-call lodging against the same limit, including failed lookups", async () => {
    const flights = fakeLive();
    let calls = 0;
    const stays = { ...createMockStayProvider(), live: true, callsPerSearch: 2, search: async () => {
      calls++;
      throw new Error("Unavailable");
    } };
    const { events, db } = await collect(flights, { perSearch: 6, stays });
    expect(flights.calls).toHaveLength(4);
    expect(calls).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "done", providerCalls: 6 });
    expect(events.filter(e => e.type === "shortlist").at(-1)?.quotes).toEqual([]);
    expect(new QuotaGuard(db, { monthlyBudget: 100, dailyClientBudget: 100 }, () => NOW).remaining("ip:test")).toBe(94);
  });

  it("skips automatic lodging when a one-way search has no checkout date", async () => {
    const { events } = await collect(fakeLive(), { perSearch: 2, stays: createMockStayProvider(), request: { ...req, tripType: "oneway" } });
    expect(events.some(e => e.type === "shortlist")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "done", providerCalls: 2 });
  });

  it("reuses fresh lodging and serves marked expired quotes without a partial quota charge", async () => {
    let stamp = NOW.getTime();
    const db = openDb(":memory:");
    const cache = new QueryCache(db, () => stamp);
    const quota = new QuotaGuard(db, { monthlyBudget: 3, dailyClientBudget: 3 }, () => NOW);
    const stays = { ...createMockStayProvider(), live: true, callsPerSearch: 2 };
    const query = { airport: "HND", checkIn: "2027-03-01", checkOut: "2027-03-08", adults: 2 };
    const lookup = () => lookupStays(query, stays, cache, quota, "a", 2, NOW);
    expect((await lookup()).units).toBe(2);
    expect(await lookup()).toMatchObject({ units: 0, cached: true });
    stamp += 7 * 86_400_000;
    const expired = await lookup();
    expect(expired).toMatchObject({ units: 0, cached: true, stale: true });
    expect(expired.stays[0].stale).toBe(true);
    expect(quota.remaining("a")).toBe(1);
  });

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

/** A live provider with a date grid: each calendar call prices every date, $1000 + 10 per day index. */
function fakeCalendar(): FlightProvider & { calls: FlightQuery[]; calendarCalls: CalendarQuery[] } {
  const inner = fakeLive();
  const calendarCalls: CalendarQuery[] = [];
  return {
    ...inner,
    name: "fakecal",
    calendarMaxDays: 20,
    calendarCalls,
    async calendar(q) {
      calendarCalls.push(q);
      const out: CalendarPrice[] = [];
      for (let d = q.rangeStart, i = 0; d <= q.rangeEnd; d = addDays(d, 1), i++) {
        out.push({ departDate: d, returnDate: q.nights === undefined ? undefined : addDays(d, q.nights), price: 1000 + ((i * 37) % 23) * 10 + (q.nights ?? 0) });
      }
      return out;
    },
  };
}

describe("calendar-first search", () => {
  it("prices whole countries and states with one Google place ID, and cities airport by airport", () => {
    expect(planCalendarRoutes({ origins: ["AUS"], destinations: ["country:JP"] })).toEqual([
      { origins: ["AUS"], destinations: ["/m/03_3d"], originAirport: "AUS", destinationAirport: "HND", originLabel: undefined, destinationLabel: "Japan" },
    ]);
    const texas = planCalendarRoutes({ origins: ["state:US-TX"], destinations: ["HNL"] });
    expect(texas).toHaveLength(1);
    expect(texas[0]).toMatchObject({ origins: ["/m/07b_l"], originLabel: "Texas", destinations: ["HNL"] });
    expect(planCalendarRoutes({ origins: ["AUS"], destinations: ["city:Tokyo|JP"] }).map((r) => r.destinations[0]).sort()).toEqual(["HND", "NRT"]);
    const asia = planCalendarRoutes({ origins: ["AUS"], destinations: ["region:Asia"] });
    expect(asia.length).toBeGreaterThan(10);
    expect(asia.every((r) => r.destinations[0].startsWith("/m/") || r.destinations[0].startsWith("/g/"))).toBe(true);
    expect(planCalendarRoutes({ origins: ["AUS"], destinations: ["AUS"] })).toEqual([]);
  });

  it("plans middle trip lengths first, splits long ranges and leaves budget for details", () => {
    const route = { origins: ["AUS"], destinations: ["NRT"], originAirport: "AUS", destinationAirport: "NRT" };
    const plan = { routes: [route], departFrom: "2027-03-01", departTo: "2027-03-31" };
    const jobs = planCalendar(req, plan, 20, 6);
    expect(jobs).toHaveLength(4); // 6 - max(1, 6/3)
    expect(jobs.map((j) => [j.query.nights, j.query.rangeStart, j.query.rangeEnd])).toEqual([
      [8, "2027-03-01", "2027-03-20"], [8, "2027-03-21", "2027-03-31"],
      [7, "2027-03-01", "2027-03-20"], [7, "2027-03-21", "2027-03-31"],
    ]);
    expect(calendarJobCount(req, plan, 20)).toBe(8);
    expect(planCalendar(req, plan, 20, 1)).toHaveLength(1);
  });

  it("prices every date with a few calls, then fetches real itineraries for the cheapest dates", async () => {
    const p = fakeCalendar();
    const { events, fares } = await collect(p, { perSearch: 6 });
    expect(p.calendarCalls).toHaveLength(4);
    expect(p.calls).toHaveLength(2); // detail lookups with the rest of the budget
    expect(events.find((e) => e.type === "done")).toMatchObject({ providerCalls: 6 });
    // NRT then HND at the middle length (8 nights), two 20-day range chunks each.
    expect(p.calendarCalls.map((q) => [q.destinations[0], q.nights])).toEqual([["NRT", 8], ["NRT", 8], ["HND", 8], ["HND", 8]]);
    const priceOnly = fares.filter((f) => f.priceOnly);
    expect(new Set(priceOnly.map((f) => `${f.departDate}|${f.returnDate}`)).size).toBe(31); // every March departure
    expect(priceOnly[0]).toMatchObject({ airlines: [], outbound: [], destination: "NRT" });
    expect(priceOnly[0].coverage).toBeUndefined(); // single airports need no coverage
    const cheapestCal = [...priceOnly].sort((a, b) => a.price - b.price)[0];
    expect(p.calls[0]).toMatchObject({ departDate: cheapestCal.departDate, returnDate: cheapestCal.returnDate });
    expect(fares.some((f) => !f.priceOnly && f.outbound.length > 0)).toBe(true);
    expect(events.some((e) => e.type === "notice" && /more places, months or trip lengths/.test(e.message))).toBe(true);
  });

  it("reads cached grids when the monthly budget is exhausted", async () => {
    const provider = fakeCalendar();
    const request = { ...req, quick: true };
    const first = await collect(provider, { perSearch: 1, monthly: 1, request });
    const second = await collect(provider, { perSearch: 1, monthly: 1, request, db: first.db });
    expect(first.fares.length).toBeGreaterThan(0);
    expect(second.fares.map(f => f.id)).toEqual(first.fares.map(f => f.id));
    expect(provider.calendarCalls).toHaveLength(1);
  });

  it("reuses cached calendars on a repeat search", async () => {
    const p = fakeCalendar();
    const first = await collect(p, { perSearch: 6 });
    const before = p.calendarCalls.length;
    const second = await collect(p, { perSearch: 6, db: first.db });
    expect(p.calendarCalls.length).toBe(before);
    expect(second.fares.filter((f) => f.priceOnly).length).toBeGreaterThan(0);
  });
});

/** A live provider with explore: three destinations per call, one outside the trip-length range. */
function fakeExplore(): FlightProvider & { calls: FlightQuery[]; exploreCalls: ExploreQuery[] } {
  const inner = fakeLive();
  const exploreCalls: ExploreQuery[] = [];
  return {
    ...inner,
    name: "fakeexp",
    exploreCalls,
    async explore(q) {
      exploreCalls.push(q);
      const m = String(q.month).padStart(2, "0");
      return [
        { destination: "CUN", name: "Cancún", departDate: `2027-${m}-05`, returnDate: `2027-${m}-13`, price: 300, airline: "United", stops: 1 },
        { destination: "LHR", name: "London", departDate: `2027-${m}-10`, returnDate: `2027-${m}-18`, price: 650, airline: "British Airways", stops: 0 },
        { destination: "DEN", name: "Denver", departDate: `2027-${m}-02`, returnDate: `2027-${m}-04`, price: 99 }, // 2 nights: outside 7-10
      ];
    },
  };
}

describe("explore-first search", () => {
  const anywhere = { ...req, destinations: ["anywhere"], departFrom: "2027-03-01", departTo: "2027-04-30" };

  it("plans one call per month and trip-length bucket, within Google's six months", () => {
    const jobs = planExplore(SearchRequestSchema.parse(anywhere), TODAY);
    expect(jobs.map((j) => [j.query.month, j.query.duration, j.query.areaId])).toEqual([[3, 2, undefined], [4, 2, undefined], [3, 3, undefined], [4, 3, undefined]]);
    const europe = planExplore(SearchRequestSchema.parse({ ...anywhere, destinations: ["region:Europe"], minNights: 7, maxNights: 8 }), TODAY);
    expect(europe.map((j) => j.query.areaId)).toEqual(["/m/02j9z", "/m/02j9z"]);
    const far = planExplore(SearchRequestSchema.parse({ ...anywhere, departFrom: "2027-09-01", departTo: "2027-09-30" }), TODAY);
    expect(far).toEqual([]); // more than six months out
  });

  it("streams explore deals in the trip-length range as price-only fares, then details the cheapest", async () => {
    const p = fakeExplore();
    const { fares, events } = await collect(p, { perSearch: 6, request: SearchRequestSchema.parse(anywhere) });
    expect(p.exploreCalls).toHaveLength(4); // 6 - 1 kept for details, capped at the 4 planned calls
    const grid = fares.filter((f) => f.priceOnly);
    expect(new Set(grid.map((f) => f.destination))).toEqual(new Set(["CUN", "LHR"]));
    expect(grid.find((f) => f.destination === "LHR")).toMatchObject({ airlines: ["British Airways"], stops: 0, origin: "AUS" });
    expect(p.calls[0]).toMatchObject({ origins: ["AUS"], destinations: ["CUN"], departDate: "2027-03-05", returnDate: "2027-03-13" });
    expect(events.find((e) => e.type === "done")).toMatchObject({ providerCalls: 6 });
  });

  it("quick searches spend the budget on prices only", async () => {
    const p = fakeExplore();
    await collect(p, { perSearch: 6, request: SearchRequestSchema.parse({ ...anywhere, quick: true, departTo: "2027-03-31", maxNights: 9 }) });
    expect(p.exploreCalls).toHaveLength(1);
    expect(p.calls).toHaveLength(0);
  });
});
