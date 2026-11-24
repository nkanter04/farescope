import type { SqlDb } from "./sql.ts";
import type { LimitReason } from "./search/limits.ts";

export interface QuotaConfig {
  monthlyBudget: number;
  /** Per anonymous visitor (IP address), per UTC day. */
  dailyClientBudget: number;
  /** Per signed-in account, per UTC month (defaults to 30 visitor days). */
  accountMonthlyBudget?: number;
  /** A specific account's monthly budget (Pro, trial), or undefined for the default. */
  accountBudget?: (clientId: string) => number | undefined;
  /** Told about every reservation and refusal (analytics: credits spent, limit hits). */
  observe?: (clientId: string, units: number, decision: QuotaDecision) => void;
}

export type QuotaDecision = { ok: true } | { ok: false; reason: LimitReason };

/** Client ids: "ip:<address>" for visitors, "user:<id>" for signed-in accounts. */
export const isAccount = (clientId: string) => clientId.startsWith("user:");

/**
 * Hard spending guard for live provider calls. One global monthly bucket (protects the API bill)
 * plus one per-client bucket: daily for anonymous visitors (keyed by IP), monthly for accounts.
 */
export class QuotaGuard {
  constructor(private db: SqlDb, private cfg: QuotaConfig, private now: () => Date = () => new Date()) {}

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

  /** The client's own allowance: monthly for accounts, daily for visitors. */
  private client(clientId: string) {
    const { month, day } = this.periods();
    return isAccount(clientId)
      ? {
          period: month,
          kind: "month" as const,
          budget: this.cfg.accountBudget?.(clientId) ?? this.cfg.accountMonthlyBudget ?? this.cfg.dailyClientBudget * 30,
          reason: "account" as const,
        }
      : { period: day, kind: "day" as const, budget: this.cfg.dailyClientBudget, reason: "daily" as const };
  }

  status(clientId: string) {
    const { month } = this.periods();
    const c = this.client(clientId);
    const used = this.read(`client:${clientId}`, c.period);
    return {
      monthlyBudget: this.cfg.monthlyBudget,
      monthlyUsed: this.read("global", month),
      scope: isAccount(clientId) ? ("account" as const) : ("visitor" as const),
      clientPeriod: c.kind,
      clientBudget: c.budget,
      clientUsed: used,
      // Older field names, kept for compatibility with saved clients.
      dailyClientBudget: c.budget,
      dailyClientUsed: used,
    };
  }

  remaining(clientId: string): number {
    const s = this.status(clientId);
    return Math.max(0, Math.min(s.monthlyBudget - s.monthlyUsed, s.clientBudget - s.clientUsed));
  }

  /** Reserve the full cost of a provider request in both buckets. */
  tryConsume(clientId: string, units = 1): QuotaDecision {
    if (!Number.isSafeInteger(units) || units < 1) throw new Error("Invalid quota units");
    const { month } = this.periods();
    const c = this.client(clientId);
    const decision = this.db.transaction((): QuotaDecision => {
      if (this.read("global", month) + units > this.cfg.monthlyBudget) return { ok: false, reason: "monthly" };
      if (this.read(`client:${clientId}`, c.period) + units > c.budget) return { ok: false, reason: c.reason };
      this.bump("global", month, units);
      this.bump(`client:${clientId}`, c.period, units);
      return { ok: true };
    });
    try { this.cfg.observe?.(clientId, units, decision); } catch { /* analytics must never block a search */ }
    return decision;
  }
}
