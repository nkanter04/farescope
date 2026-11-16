import { todayISO, type Fare, type SearchEvent, type SearchRequest } from "@farescope/shared";
import { ttlFor, type QueryCache } from "../cache.ts";
import type { QuotaGuard } from "../quota.ts";
import type { FlightProvider, FlightResult } from "../providers/types.ts";
import { planSearch, refineCandidates, sampleCandidates, type Candidate } from "./planner.ts";

export interface RunDeps {
  provider: FlightProvider;
  cache: QueryCache;
  quota: QuotaGuard;
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
 *  2. an evenly spread sample of the rest, within budget,
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

  const budget = provider.live ? Math.min(deps.perSearchBudget, quota.remaining(deps.clientId)) : deps.freeCallCap;
  const firstPassSize = provider.live ? Math.max(1, Math.ceil(budget * 0.6)) : budget;
  const firstPass = budget > 0 ? sampleCandidates(uncached, firstPassSize) : [];

  emit({ type: "start", totalCandidates: plan.candidates.length, plannedCalls: Math.min(budget, uncached.length), live: provider.live });
  if (provider.live && budget === 0 && uncached.length) {
    emit({ type: "notice", level: "warn", message: "Live search budget used up. Showing cached prices only." });
  }

  // Streaming state: only forward fares that matter to the UI, to keep the stream small.
  const cellBest = new Map<string, number>(); // "depart|nights" -> price
  const destBest = new Map<string, number>(); // airport -> price
  const top: number[] = []; // sorted prices of the global top N
  const bestForRefine: { routeGroup: number; departDate: string; nights: number | null; price: number }[] = [];
  let fareCount = 0;
  let providerCalls = 0;
  let cacheHits = 0;
  let done = 0;
  let quotaNoticeSent = false;
  const tried = new Set<string>();
  const totalWork = fresh.length + firstPass.length;

  const consider = (c: Candidate, fares: Fare[], flags: { cached: boolean; stale?: boolean }) => {
    if (!fares.length) return;
    const sorted = [...fares].sort((a, b) => a.price - b.price);
    const cheapest = sorted[0];
    bestForRefine.push({ routeGroup: c.routeGroup, departDate: c.query.departDate, nights: c.nights, price: cheapest.price });
    const send = new Map<string, Fare>();
    const cell = `${c.query.departDate}|${c.nights ?? "-"}`;
    if ((cellBest.get(cell) ?? Infinity) > cheapest.price) {
      cellBest.set(cell, cheapest.price);
      send.set(cheapest.id, cheapest);
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
      emit({ type: "fare", fare: { ...f, cached: flags.cached, stale: flags.stale } });
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
      if (provider.live) cache.recordPrices(result.fares, c.query.cabin);
      consider(c, result.fares, { cached: false });
      if (result.insights && provider.live) {
        emit({ type: "insights", route: `${c.query.origins.join(",")}>${c.query.destinations.join(",")}`, insights: result.insights });
      }
    } catch (e) {
      if (hit) consider(c, hit.value.fares, { cached: true, stale: true });
      emit({ type: "notice", level: "warn", message: `Provider error on ${c.query.departDate}: ${(e as Error).message}` });
    }
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

  const leftover = budget - providerCalls;
  if (leftover > 0 && !deps.signal?.aborted) {
    const best = [...bestForRefine].sort((a, b) => a.price - b.price).slice(0, 5);
    const refine = refineCandidates(uncached, tried, best, leftover);
    await runPool(refine);
  }

  emit({ type: "progress", done, total: done, providerCalls });
  emit({ type: "done", fares: fareCount, providerCalls, cacheHits });
}
