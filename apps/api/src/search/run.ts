import { addDays, AIRPORT_BY_IATA, daysBetween, REGION_IDS, fareMatchesAirlines, resolveAll, resolvePlace, todayISO, type Place, type Fare, type SearchEvent, type SearchRequest } from "@farescope/shared";
import type { Cabin } from "@farescope/shared";
import { ttlFor } from "../ttl.ts";
import { calendarQueryKey, exploreQueryKey, flightQueryKey, type CalendarPrice, type CalendarQuery, type ExploreDeal, type ExploreQuery, type FlightProvider, type FlightQuery, type FlightResult } from "../providers/types.ts";
import { planSearch, refineCandidates, sampleCandidates, type Candidate } from "./planner.ts";

/**
 * What the search needs from storage. SQLite (QueryCache/QuotaGuard) on the server; plain
 * in-memory versions in the browser-only demo. Keep this file free of Node-only imports.
 */
export interface SearchCache {
  get<T>(key: string): { value: T; fetchedAt: number; expired: boolean } | undefined;
  put(key: string, provider: string, value: unknown, ttlMs: number): void;
  recordPrices(fares: Fare[], cabin: Cabin, searchKey: string): void;
}
export interface SearchQuota {
  remaining(clientId: string): number;
  tryConsume(clientId: string, units?: number): { ok: true } | { ok: false; reason: "monthly" | "daily" };
}

export interface RunDeps {
  provider: FlightProvider;
  cache: SearchCache;
  quota: SearchQuota;
  clientId: string;
  /** Max live calls this one search may spend. */
  perSearchBudget: number;
  /** Max calls for free (mock) providers, to bound CPU and payload size. */
  freeCallCap: number;
  concurrency?: number;
  now?: () => Date;
  signal?: AbortSignal;
}

const TOP_N = 40;

/**
 * Run a flexible search and stream results. Order of work:
 *  1. everything already in the fresh cache (free),
 *  2. providers with a date grid (calendar): one call per route x trip length x range chunk prices
 *     every departure date (price-only fares), then full itineraries for the cheapest dates.
 *     Other providers: an evenly spread sample of the rest, within budget, then
 *  3. refinement around the cheapest fares found, with the leftover budget.
 * When the live budget runs out, expired cache entries are served (marked stale) instead.
 */
export async function runSearch(req: SearchRequest, deps: RunDeps, emit: (e: SearchEvent) => void): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const { provider, cache, quota } = deps;
  const plan = planSearch(req, provider, todayISO(now()));

  if (plan.unknown.length) emit({ type: "notice", level: "warn", message: `Unknown place(s) ignored: ${plan.unknown.join(", ")}` });
  if (plan.candidates.length === 0) {
    emit({ type: "error", message: "Nothing to search: check the places and that the dates are not in the past." });
    return;
  }

  const fresh: Candidate[] = [];
  const uncached: Candidate[] = [];
  for (const c of plan.candidates) {
    const hit = cache.get<FlightResult>(c.key);
    (hit && !hit.expired ? fresh : uncached).push(c);
  }

  // Searches price flights only; stays are looked up separately when planning a trip (/api/stays).
  const liveLimit = Math.min(deps.perSearchBudget, quota.remaining(deps.clientId));
  const budget = provider.live ? liveLimit : deps.freeCallCap;
  // Price grids: "anywhere" and regions through explore, named places through the calendar.
  const today = todayISO(now());
  const exploreAll = provider.explore ? planExplore(req, today) : [];
  // Plan grid calls for the full per-search budget even when the live budget is short or gone:
  // calls beyond it only read the cache (see fetchGrid), so cached prices still show.
  const gridBudget = provider.live ? Math.max(budget, deps.perSearchBudget) : budget;
  const exploreJobs = exploreAll.slice(0, Math.max(0, req.quick ? gridBudget : gridBudget - 1));
  const calendarRoutes = provider.calendar ? planCalendarRoutes(req, { skipBroad: !!provider.explore }) : [];
  const calendarPlan = { routes: calendarRoutes, departFrom: plan.departFrom, departTo: plan.departTo };
  const calendarBudget = gridBudget - exploreJobs.length;
  const calendarJobs = provider.calendar && calendarBudget > 0
    ? planCalendar(req, calendarPlan, provider.calendarMaxDays ?? 60, calendarBudget, { reserveForDetails: !req.quick })
    : [];
  const useGrid = calendarJobs.length > 0 || exploreJobs.length > 0;
  const firstPassSize = provider.live ? Math.max(1, Math.ceil(budget * 0.6)) : budget;
  const firstPass = budget > 0 && !useGrid ? sampleCandidates(uncached, firstPassSize) : [];

  emit({ type: "start", totalCandidates: plan.totalCandidates, plannedCalls: useGrid ? budget : Math.min(budget, uncached.length), live: provider.live });
  const gridIncomplete = exploreJobs.length < exploreAll.length
    || (calendarRoutes.length > 0 && calendarJobs.length < calendarJobCount(req, calendarPlan, provider.calendarMaxDays ?? 60));
  if (useGrid && gridIncomplete) {
    emit({ type: "notice", level: "info", message: "This search covers more places, months or trip lengths than one search can price. Narrow it to see every date." });
  } else if (!useGrid && plan.totalCandidates > plan.candidates.length) emit({ type: "notice", level: "info", message: "This broad search samples routes and dates. Narrow the airports or date window for more coverage." });
  if (!provider.live) emit({ type: "notice", level: "info", message: "Demo prices and flight times are simulated. Connections use a historical 2014 route network. Current service may differ." });
  if (provider.live && budget === 0 && uncached.length) {
    emit({ type: "notice", level: "warn", message: "Live search budget used up. Showing cached prices only." });
  }

  // Streaming state: only forward fares that matter to the UI, to keep the stream small.
  const cellBest = new Map<string, number>(); // "depart|nights" -> price
  const gridCells = new Set<string>(); // cells whose best price so far is a date-grid (price-only) price
  const destBest = new Map<string, number>(); // airport -> price
  const top: number[] = []; // sorted prices of the global top N
  const bestForRefine: { routeGroup: number; departDate: string; nights: number | null; price: number }[] = [];
  let fareCount = 0;
  let providerCalls = 0;
  let cacheHits = 0;
  let done = 0;
  let quotaNoticeSent = false;
  const tried = new Set<string>();
  let totalWork = fresh.length + firstPass.length + calendarJobs.length + exploreJobs.length;

  const consider = (c: Candidate, fares: Fare[], flags: { cached: boolean; stale?: boolean }) => {
    if (!fares.length) return;
    // Date-grid prices were already filtered by the provider (stops, airlines) and carry no details.
    const sorted = fares
      .filter(fare => fare.priceOnly || ((req.maxStops === null || fare.stops <= req.maxStops) && fareMatchesAirlines(fare, req.airlines ?? [])))
      .sort((a, b) => a.price - b.price);
    if (!sorted.length) return;
    const cheapest = sorted[0];
    bestForRefine.push({ routeGroup: c.routeGroup, departDate: c.query.departDate, nights: c.nights, price: cheapest.price });
    const send = new Map<string, Fare>();
    const cell = `${c.query.departDate}|${c.nights ?? "-"}`;
    // A real itinerary always replaces a date-grid price for its cell, even when it costs a bit more:
    // the grid price is Google's lowest for the whole place, the itinerary is what can be booked.
    const replacesGridPrice = !cheapest.priceOnly && gridCells.delete(cell);
    if (replacesGridPrice || (cellBest.get(cell) ?? Infinity) > cheapest.price) {
      cellBest.set(cell, cheapest.price);
      send.set(cheapest.id, cheapest);
      if (cheapest.priceOnly) gridCells.add(cell);
    }
    for (const f of sorted) {
      if ((destBest.get(f.destination) ?? Infinity) > f.price) {
        destBest.set(f.destination, f.price);
        send.set(f.id, f);
      }
      if (top.length < TOP_N || f.price < top[top.length - 1]) {
        top.push(f.price);
        top.sort((a, b) => a - b);
        if (top.length > TOP_N) top.pop();
        send.set(f.id, f);
      } else break; // sorted: nothing cheaper follows for the top list
    }
    for (const f of send.values()) {
      fareCount++;
      const fare = { ...f, cached: flags.cached, stale: flags.stale, queryKey: c.key };
      emit({ type: "fare", fare });
    }
  };

  const execute = async (c: Candidate): Promise<void> => {
    if (deps.signal?.aborted) return;
    tried.add(c.key);
    const hit = cache.get<FlightResult>(c.key);
    if (hit && !hit.expired) {
      cacheHits++;
      consider(c, hit.value.fares, { cached: true });
      return;
    }
    if (provider.live) {
      const decision = quota.tryConsume(deps.clientId);
      if (!decision.ok) {
        if (hit) consider(c, hit.value.fares, { cached: true, stale: true });
        if (!quotaNoticeSent) {
          quotaNoticeSent = true;
          emit({
            type: "notice",
            level: "warn",
            message:
              decision.reason === "monthly"
                ? "This month's live search budget is used up. Showing cached prices."
                : "You've hit today's live search limit. Showing cached prices.",
          });
        }
        return;
      }
    }
    try {
      providerCalls++;
      const result = await provider.search(c.query);
      cache.put(c.key, provider.name, result, ttlFor(c.query.departDate, now()));
      if (provider.live) cache.recordPrices(result.fares, c.query.cabin, c.key);
      consider(c, result.fares, { cached: false });
      if (result.insights && provider.live) {
        emit({ type: "insights", route: `${c.query.origins.join(",")}>${c.query.destinations.join(",")}`, insights: result.insights });
      }
    } catch (e) {
      if (hit) consider(c, hit.value.fares, { cached: true, stale: true });
      emit({ type: "notice", level: "warn", message: `Provider error on ${c.query.departDate}: ${(e as Error).message}` });
    }
  };

  /**
   * Price grids (calendar and explore calls): cache first, then one quota unit per live call, with
   * expired cache as the fallback. Results stream as price-only fares; opening one fetches flights.
   */
  const gridPriced: GridPrice[] = [];
  const fetchGrid = async <T>(key: string, ttlDate: string, label: string, call: () => Promise<T>): Promise<{ value?: T; flags: { cached: boolean; stale?: boolean } }> => {
    const hit = cache.get<T>(key);
    if (hit && !hit.expired) {
      cacheHits++;
      return { value: hit.value, flags: { cached: true } };
    }
    if (provider.live && providerCalls >= budget) return { value: hit?.value, flags: { cached: true, stale: true } };
    const decision = provider.live ? quota.tryConsume(deps.clientId) : { ok: true as const };
    if (!decision.ok) {
      if (!quotaNoticeSent) {
        quotaNoticeSent = true;
        emit({
          type: "notice",
          level: "warn",
          message: decision.reason === "monthly"
            ? "This month's live search budget is used up. Showing cached prices."
            : "You've hit today's live search limit. Showing cached prices.",
        });
      }
      return { value: hit?.value, flags: { cached: true, stale: true } };
    }
    try {
      providerCalls++;
      const value = await call();
      cache.put(key, provider.name, value, ttlFor(ttlDate, now()));
      return { value, flags: { cached: false } };
    } catch (e) {
      emit({ type: "notice", level: "warn", message: `Provider error on ${label}: ${(e as Error).message}` });
      return { value: hit?.value, flags: { cached: true, stale: true } };
    }
  };

  const streamGridFare = (
    route: { origins: string[]; destinations: string[] },
    fare: Omit<Fare, "provider" | "currency" | "outbound" | "fetchedAt" | "cached" | "priceOnly">,
    flags: { cached: boolean; stale?: boolean },
  ) => {
    const nights = fare.returnDate ? daysBetween(fare.departDate, fare.returnDate) : null;
    const query: FlightQuery = {
      origins: route.origins, destinations: route.destinations, departDate: fare.departDate, returnDate: fare.returnDate,
      cabin: req.cabin, maxStops: req.maxStops, adults: req.adults, airlines: req.airlines?.length ? req.airlines : undefined,
    };
    const c: Candidate = { key: flightQueryKey(provider.name, query), query, routeGroup: -1, nights };
    gridPriced.push({ route, departDate: fare.departDate, nights, price: fare.price });
    consider(c, [{ ...fare, provider: provider.name, currency: "USD", outbound: [], fetchedAt: now().toISOString(), cached: flags.cached, priceOnly: true }], flags);
  };

  const executeCalendar = async (job: CalendarJob): Promise<void> => {
    if (deps.signal?.aborted || !provider.calendar) return;
    const calendar = provider.calendar.bind(provider);
    const { value: prices, flags } = await fetchGrid(calendarQueryKey(provider.name, job.query), job.query.rangeStart,
      `${job.query.rangeStart} to ${job.query.rangeEnd}`, () => calendar(job.query));
    const { route } = job;
    const coverage = route.originLabel || route.destinationLabel
      ? { origins: route.origins, destinations: route.destinations, originLabel: route.originLabel, destinationLabel: route.destinationLabel }
      : undefined;
    for (const p of (prices as CalendarPrice[] | undefined) ?? []) {
      streamGridFare(route, {
        id: `cal-${route.origins.join("")}-${route.destinations.join("")}-${p.departDate}-${p.returnDate ?? "ow"}`.slice(0, 200),
        origin: route.originAirport,
        destination: route.destinationAirport,
        departDate: p.departDate,
        returnDate: p.returnDate,
        price: p.price,
        airlines: [],
        stops: 0,
        durationMin: 0,
        coverage,
      }, flags);
    }
  };

  const executeExplore = async (job: ExploreJob): Promise<void> => {
    if (deps.signal?.aborted || !provider.explore) return;
    const explore = provider.explore.bind(provider);
    const { value: deals, flags } = await fetchGrid(exploreQueryKey(provider.name, job.query), job.monthStart,
      `explore ${job.monthStart.slice(0, 7)}`, () => explore(job.query));
    for (const d of (deals as ExploreDeal[] | undefined) ?? []) {
      if (!AIRPORT_BY_IATA[d.destination] || d.destination === job.originAirport) continue;
      if (d.departDate < req.departFrom || d.departDate > req.departTo) continue;
      const nights = d.returnDate ? daysBetween(d.departDate, d.returnDate) : null;
      if (req.tripType === "roundtrip" && (nights === null || nights < req.minNights || nights > req.maxNights)) continue;
      const route = { origins: [job.query.origin], destinations: [d.destination] };
      streamGridFare(route, {
        id: `exp-${job.query.origin}-${d.destination}-${d.departDate}-${d.returnDate ?? "ow"}`.slice(0, 200),
        origin: job.originAirport,
        destination: d.destination,
        departDate: d.departDate,
        returnDate: d.returnDate,
        price: d.price,
        airlines: d.airline ? [d.airline] : [],
        stops: d.stops ?? 0,
        durationMin: d.durationMin ?? 0,
        coverage: job.originLabel ? { origins: route.origins, destinations: route.destinations, originLabel: job.originLabel } : undefined,
      }, flags);
    }
  };

  const runGrid = async <J>(jobs: J[], run: (job: J) => Promise<void>) => {
    const conc = deps.concurrency ?? 3;
    let i = 0;
    const worker = async () => {
      while (i < jobs.length && !deps.signal?.aborted) {
        await run(jobs[i++]);
        done++;
        emit({ type: "progress", done, total: totalWork, providerCalls });
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, worker));
  };

  const runPool = async (items: Candidate[]) => {
    const conc = deps.concurrency ?? (provider.live ? 3 : 16);
    let i = 0;
    const worker = async () => {
      while (i < items.length && !deps.signal?.aborted) {
        const c = items[i++];
        await execute(c);
        done++;
        if (done % 10 === 0 || done === totalWork) emit({ type: "progress", done, total: totalWork, providerCalls });
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  };

  await runPool(fresh);
  await runPool(firstPass);
  if (useGrid) {
    await runGrid(exploreJobs, executeExplore);
    await runGrid(calendarJobs, executeCalendar);
    // Full itineraries (airlines, stops, times, Google's price insights) for the cheapest dates.
    const detailBudget = req.quick ? 0 : budget - providerCalls;
    if (detailBudget > 0 && !deps.signal?.aborted) {
      const details = cheapestDetailCandidates(gridPriced, req, provider.name, tried, detailBudget);
      totalWork += details.length;
      await runPool(details);
    }
  }

  const leftover = budget - providerCalls;
  if (!useGrid && leftover > 0 && !deps.signal?.aborted) {
    const best = [...bestForRefine].sort((a, b) => a.price - b.price).slice(0, 5);
    const refine = refineCandidates(uncached, tried, best, leftover);
    await runPool(refine);
  }

  emit({ type: "progress", done, total: done, providerCalls });
  emit({ type: "done", fares: fareCount, providerCalls, cacheHits });
}

/**
 * One calendar route: a single place on each side (Google's calendar takes one airport or one place
 * ID per side, not a list). `originAirport`/`destinationAirport` stand in for the place on the map.
 */
export interface CalendarRoute {
  origins: string[];
  destinations: string[];
  originAirport: string;
  destinationAirport: string;
  /** Set when the side is a whole place (country, state, region part) rather than one airport. */
  originLabel?: string;
  destinationLabel?: string;
}

interface CalendarSide { id: string; airport: string; label?: string }

/** The airport that best stands for a place: one in the city with the most airports in the list. */
export function representativeAirport(airports: string[]): string {
  const perCity = new Map<string, number>();
  for (const a of airports) {
    const k = `${AIRPORT_BY_IATA[a]?.city}|${AIRPORT_BY_IATA[a]?.country}`;
    perCity.set(k, (perCity.get(k) ?? 0) + 1);
  }
  let best = airports[0];
  let bestN = 0;
  for (const a of airports) {
    const n = perCity.get(`${AIRPORT_BY_IATA[a]?.city}|${AIRPORT_BY_IATA[a]?.country}`) ?? 0;
    if (n > bestN) { best = a; bestN = n; }
  }
  return best;
}

function placeSides(place: Place): CalendarSide[] {
  if (place.googleId) return [{ id: place.googleId, airport: representativeAirport(place.airports), label: place.label }];
  if (place.kind === "region" || place.kind === "anywhere") {
    // One side per country (its Google ID covers every airport there).
    const countries = [...new Set(place.airports.map((a) => AIRPORT_BY_IATA[a]?.country).filter(Boolean))];
    return countries.flatMap((cc) => {
      const country = resolvePlace(`country:${cc}`);
      return country ? placeSides(country) : [];
    });
  }
  // Single airports, and multi-airport cities one airport at a time.
  return place.airports.map((a) => ({ id: a, airport: a }));
}

const isBroad = (p: Place) => p.kind === "anywhere" || p.kind === "region";
const dedupeSides = (sides: CalendarSide[]) => [...new Map(sides.map((s) => [s.id, s])).values()];

/**
 * Calendar routes for a search: every origin side x every destination side. With `skipBroad`,
 * "anywhere" and region destinations are left to explore calls instead.
 */
export function planCalendarRoutes(req: Pick<SearchRequest, "origins" | "destinations">, opts: { skipBroad?: boolean } = {}): CalendarRoute[] {
  const from = dedupeSides(resolveAll(req.origins).places.flatMap(placeSides));
  const to = dedupeSides(resolveAll(req.destinations).places.filter((p) => !(opts.skipBroad && isBroad(p))).flatMap(placeSides));
  const routes: CalendarRoute[] = [];
  for (const o of from) {
    for (const d of to) {
      if (o.id === d.id || o.airport === d.airport) continue;
      routes.push({
        origins: [o.id], destinations: [d.id], originAirport: o.airport, destinationAirport: d.airport,
        originLabel: o.label, destinationLabel: d.label,
      });
    }
  }
  return routes;
}

export interface CalendarJob {
  routeGroup: number;
  route: CalendarRoute;
  query: CalendarQuery;
}

function nightOptions(req: SearchRequest): (number | undefined)[] {
  if (req.tripType === "oneway") return [undefined];
  const out: number[] = [];
  for (let n = req.minNights; n <= req.maxNights; n++) out.push(n);
  return out;
}

function rangeChunks(from: string, to: string, maxDays: number): [string, string][] {
  const out: [string, string][] = [];
  for (let start = from; start <= to; start = addDays(start, maxDays)) {
    const end = addDays(start, maxDays - 1);
    out.push([start, end < to ? end : to]);
  }
  return out;
}

type CalendarPlan = { routes: CalendarRoute[]; departFrom: string; departTo: string };

/** How many date-grid calls would cover the whole search. */
export function calendarJobCount(req: SearchRequest, plan: CalendarPlan, maxDays: number): number {
  if (plan.departFrom > plan.departTo) return 0;
  return plan.routes.length * nightOptions(req).length * rangeChunks(plan.departFrom, plan.departTo, maxDays).length;
}

/**
 * Date-grid calls for a search, most useful first, within `budget`, leaving about a third of it (at
 * least one call) for full itineraries. Every route is priced at the middle trip length first, then
 * the other lengths spreading outward, so a small budget still covers every route.
 */
export function planCalendar(req: SearchRequest, plan: CalendarPlan, maxDays: number, budget: number, opts: { reserveForDetails?: boolean } = {}): CalendarJob[] {
  if (plan.departFrom > plan.departTo || !plan.routes.length) return [];
  const reserve = opts.reserveForDetails ?? true;
  const limit = !reserve || budget <= 1 ? budget : budget - Math.max(1, Math.floor(budget / 3));
  const nights = nightOptions(req);
  const mid = Math.floor((nights.length - 1) / 2);
  const ordered = nights
    .map((n, i) => ({ n, d: Math.abs(i - mid) + (i > mid ? 0.5 : 0) }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.n);
  const chunks = rangeChunks(plan.departFrom, plan.departTo, maxDays);
  const jobs: CalendarJob[] = [];
  for (const n of ordered) {
    for (const [g, route] of plan.routes.entries()) {
      for (const [rangeStart, rangeEnd] of chunks) {
        if (jobs.length >= limit) return jobs;
        jobs.push({
          routeGroup: g,
          route,
          query: {
            origins: route.origins, destinations: route.destinations, rangeStart, rangeEnd, nights: n,
            cabin: req.cabin, maxStops: req.maxStops, adults: req.adults, airlines: req.airlines?.length ? req.airlines : undefined,
          },
        });
      }
    }
  }
  return jobs;
}

export interface GridPrice {
  route: { origins: string[]; destinations: string[] };
  departDate: string;
  nights: number | null;
  price: number;
}

/** Exact-date candidates for the cheapest date-grid prices, one per date pair, cheapest first. */
export function cheapestDetailCandidates(priced: GridPrice[], req: SearchRequest, providerName: string, tried: Set<string>, n: number): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const p of [...priced].sort((a, b) => a.price - b.price)) {
    if (out.length >= n) break;
    const query: FlightQuery = {
      origins: p.route.origins, destinations: p.route.destinations, departDate: p.departDate,
      returnDate: p.nights === null ? undefined : addDays(p.departDate, p.nights),
      cabin: req.cabin, maxStops: req.maxStops, adults: req.adults, airlines: req.airlines?.length ? req.airlines : undefined,
    };
    const key = flightQueryKey(providerName, query);
    if (seen.has(key) || tried.has(key)) continue;
    seen.add(key);
    out.push({ key, query, routeGroup: -1, nights: p.nights });
  }
  return out;
}

export interface ExploreJob {
  query: ExploreQuery;
  originAirport: string;
  originLabel?: string;
  /** First day of the explored month (for cache TTLs). */
  monthStart: string;
}

/** Google Explore's trip-length buckets: 1 weekend (up to 3 nights), 2 about a week, 3 about two weeks. */
function durationBuckets(req: SearchRequest): (1 | 2 | 3 | undefined)[] {
  if (req.tripType === "oneway") return [undefined];
  const mid = (req.minNights + req.maxNights) / 2;
  const bucket = (n: number): 1 | 2 | 3 => (n <= 3 ? 1 : n <= 9 ? 2 : 3);
  const all = [...new Set([bucket(req.minNights), bucket(req.maxNights), bucket(Math.round(mid))])];
  return all.sort((a, b) => Math.abs(a - bucket(mid)) - Math.abs(b - bucket(mid)));
}

/**
 * Explore calls for "anywhere" and region destinations: per origin x area x month x trip-length
 * bucket, ordered so a small budget covers every month at the most likely trip length first.
 * Google Explore only offers the next six months.
 */
export function planExplore(req: SearchRequest, today: string): ExploreJob[] {
  const broad = resolveAll(req.destinations).places.filter(isBroad);
  if (!broad.length) return [];
  const areas = [...new Set(broad.flatMap((p) => (p.kind === "anywhere" ? [""] : REGION_IDS[p.label] ?? [])))];
  const origins = dedupeSides(resolveAll(req.origins).places.flatMap(placeSides));
  const lastMonth = addDays(today, 183);
  const months: string[] = [];
  for (let d = `${req.departFrom.slice(0, 7)}-01`; d <= req.departTo && d <= lastMonth; ) {
    if (addDays(d, 31) > today) months.push(d);
    const [y, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
    d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  const jobs: ExploreJob[] = [];
  for (const duration of durationBuckets(req)) {
    for (const monthStart of months) {
      for (const areaId of areas) {
        for (const o of origins) {
          jobs.push({
            originAirport: o.airport,
            originLabel: o.label,
            monthStart,
            query: {
              origin: o.id, areaId: areaId || undefined, month: Number(monthStart.slice(5, 7)), duration,
              cabin: req.cabin, maxStops: req.maxStops, adults: req.adults, airlines: req.airlines?.length ? req.airlines : undefined,
            },
          });
        }
      }
    }
  }
  return jobs;
}
