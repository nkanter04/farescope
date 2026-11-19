import type { SqlDb } from "./sql.ts";
import type { Cabin, Fare } from "@farescope/shared";

export { ttlFor } from "./ttl.ts";

export interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  expired: boolean;
}

export class QueryCache {
  constructor(private db: SqlDb, private now: () => number = Date.now) {}

  get<T>(key: string): CacheEntry<T> | undefined {
    const row = this.db.prepare("SELECT payload, fetched_at, expires_at FROM query_cache WHERE key = ?").get(key) as
      | { payload: string; fetched_at: number; expires_at: number }
      | undefined;
    if (!row) return undefined;
    return { value: JSON.parse(row.payload) as T, fetchedAt: row.fetched_at, expired: row.expires_at <= this.now() };
  }

  put(key: string, provider: string, value: unknown, ttlMs: number): void {
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO query_cache (key, provider, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      )
      .run(key, provider, JSON.stringify(value), t, t + ttlMs);
  }

  recordPrices(fares: Fare[], cabin: Cabin): void {
    const stmt = this.db.prepare(
      `INSERT INTO price_history (provider, origin, destination, depart_date, return_date, cabin, price, stops, airlines, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const t = this.now();
    for (const f of fares) {
      stmt.run(f.provider, f.origin, f.destination, f.departDate, f.returnDate ?? null, cabin, f.price, f.stops, f.airlines.join(","), t);
    }
  }
}
