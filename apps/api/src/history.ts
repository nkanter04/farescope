import type { SqlDb } from "./sql.ts";
import type { CurveSeries, Fare, PricePoint, PriceWatch } from "@farescope/shared";

/**
 * Server-side reads of the price_history table (every real fare ever seen) for price predictions,
 * plus storage for price watches. Mock searches never write price_history, so these stay empty in
 * the demo and the forecast falls back to simulated history.
 */
export class PriceHistory {
  constructor(private db: SqlDb) {}

  /** This route and these dates: lowest observed price per day. */
  forFare(fare: Fare): PricePoint[] {
    if (!fare.queryKey) return [];
    const rows = this.db.prepare("SELECT day, price FROM scoped_history WHERE search_key = ? AND origin = ? AND destination = ? ORDER BY day")
      .all(fare.queryKey, fare.origin, fare.destination) as { day: string; price: number }[];
    return rows.map((r) => ({ date: r.day, price: r.price }));
  }

  /** Previous flights' daily price series, for learning the booking curve. */
  series(limitSeries = 500): CurveSeries[] {
    const rows = this.db
      .prepare(
        `SELECT search_key || ':' || origin || ':' || destination AS k, depart_date AS depart, day, price
         FROM scoped_history WHERE depart_date >= date('now', '-400 days') ORDER BY k, day LIMIT 50000`,
      )
      .all() as { k: string; depart: string; day: string; price: number }[];
    const byKey = new Map<string, CurveSeries>();
    for (const r of rows) {
      let s = byKey.get(r.k);
      if (!s) byKey.set(r.k, (s = { departDate: r.depart, points: [] }));
      s.points.push({ date: r.day, price: r.price });
    }
    return [...byKey.values()].filter((s) => s.points.length >= 2).slice(0, limitSeries);
  }

  /**
   * Series from the older, unscoped price_history table (recorded before searches were scoped by
   * cabin and party). Split by cabin; party size is unknown there, so only the backtest uses it.
   */
  legacySeries(limitSeries = 500): CurveSeries[] {
    const rows = this.db
      .prepare(
        `SELECT origin || destination || depart_date || IFNULL(return_date, '') || cabin AS k, depart_date AS depart,
                date(fetched_at / 1000, 'unixepoch') AS day, MIN(price) AS price
         FROM price_history WHERE depart_date >= date('now', '-400 days')
         GROUP BY k, day ORDER BY k, day LIMIT 50000`,
      )
      .all() as { k: string; depart: string; day: string; price: number }[];
    const byKey = new Map<string, CurveSeries>();
    for (const r of rows) {
      let s = byKey.get(r.k);
      if (!s) byKey.set(r.k, (s = { departDate: r.depart, points: [] }));
      s.points.push({ date: r.day, price: r.price });
    }
    return [...byKey.values()].filter((s) => s.points.length >= 2).slice(0, limitSeries);
  }
}

export class WatchStore {
  constructor(private db: SqlDb) {}

  list(owner: string): PriceWatch[] {
    const rows = this.db.prepare("SELECT data FROM watches WHERE owner = ? ORDER BY created_at DESC").all(owner) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as PriceWatch);
  }

  count(owner: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM watches WHERE owner = ?").get(owner) as { n: number }).n;
  }

  save(owner: string, watch: PriceWatch): void {
    this.db
      .prepare(
        `INSERT INTO watches (id, owner, data, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data WHERE watches.owner = excluded.owner`,
      )
      .run(watch.id, owner, JSON.stringify(watch), Date.parse(watch.createdAt));
  }

  /** Move every watch from one owner to another (a browser's watches to a new account). */
  reassign(from: string, to: string): number {
    return Number(this.db.prepare("UPDATE watches SET owner = ? WHERE owner = ?").run(to, from).changes);
  }

  remove(owner: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM watches WHERE owner = ? AND id = ?").run(owner, id).changes) > 0;
  }
}
