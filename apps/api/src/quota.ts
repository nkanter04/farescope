import type { DatabaseSync } from "node:sqlite";

export interface QuotaConfig {
  monthlyBudget: number;
  dailyClientBudget: number;
}

export type QuotaDecision = { ok: true } | { ok: false; reason: "monthly" | "daily" };

/**
 * Hard spending guard for live provider calls. One global monthly bucket (protects the API bill)
 * and one per-client daily bucket (stops a single visitor from draining it).
 */
export class QuotaGuard {
  constructor(private db: DatabaseSync, private cfg: QuotaConfig, private now: () => Date = () => new Date()) {}

  private periods() {
    const iso = this.now().toISOString();
    return { month: iso.slice(0, 7), day: iso.slice(0, 10) };
  }

  private read(bucket: string, period: string): number {
    const row = this.db.prepare("SELECT count FROM usage WHERE bucket = ? AND period = ?").get(bucket, period) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  private bump(bucket: string, period: string, units: number): void {
    this.db
      .prepare(
        `INSERT INTO usage (bucket, period, count) VALUES (?, ?, ?)
         ON CONFLICT(bucket, period) DO UPDATE SET count = count + excluded.count`,
      )
      .run(bucket, period, units);
  }

  status(clientId: string) {
    const { month, day } = this.periods();
    return {
      monthlyBudget: this.cfg.monthlyBudget,
      monthlyUsed: this.read("global", month),
      dailyClientBudget: this.cfg.dailyClientBudget,
      dailyClientUsed: this.read(`client:${clientId}`, day),
    };
  }

  remaining(clientId: string): number {
    const s = this.status(clientId);
    return Math.max(0, Math.min(s.monthlyBudget - s.monthlyUsed, s.dailyClientBudget - s.dailyClientUsed));
  }

  /** Reserve the full cost of a provider request in both buckets. */
  tryConsume(clientId: string, units = 1): QuotaDecision {
    if (!Number.isSafeInteger(units) || units < 1) throw new Error("Invalid quota units");
    const { month, day } = this.periods();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.read("global", month) + units > this.cfg.monthlyBudget) {
        this.db.exec("ROLLBACK");
        return { ok: false, reason: "monthly" };
      }
      if (this.read(`client:${clientId}`, day) + units > this.cfg.dailyClientBudget) {
        this.db.exec("ROLLBACK");
        return { ok: false, reason: "daily" };
      }
      this.bump("global", month, units);
      this.bump(`client:${clientId}`, day, units);
      this.db.exec("COMMIT");
      return { ok: true };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
