import { addDays } from "@farescope/shared";
import type { SqlDb } from "./sql.ts";

/**
 * Data retention (the privacy policy promises this): per-visitor search counters are keyed by IP
 * address, so they are deleted after 31 days. Cache entries far past expiry are dropped too (an
 * expired entry is still useful for a while as a stale fallback when the budget runs out).
 */
export const CLIENT_COUNTER_DAYS = 31;
export const STALE_CACHE_DAYS = 30;

export function pruneOldData(db: SqlDb, now: Date): { counters: number; cache: number } {
  const today = now.toISOString().slice(0, 10);
  const cutoffDay = addDays(today, -CLIENT_COUNTER_DAYS);
  const counters = db.prepare("DELETE FROM usage WHERE bucket LIKE 'client:%' AND period < ?").run(cutoffDay).changes;
  const cache = db.prepare("DELETE FROM query_cache WHERE expires_at < ?").run(now.getTime() - STALE_CACHE_DAYS * 86_400_000).changes;
  return { counters: Number(counters), cache: Number(cache) };
}

/** Runs `pruneOldData` at most once a day per process (cheap check on each request). */
export function dailyPruner(db: SqlDb, now: () => Date = () => new Date()) {
  let lastDay = "";
  return () => {
    const day = now().toISOString().slice(0, 10);
    if (day === lastDay) return;
    lastDay = day;
    pruneOldData(db, now());
  };
}
