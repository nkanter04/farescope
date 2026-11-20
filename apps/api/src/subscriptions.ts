import type { SqlDb } from "./sql.ts";
import type { ProPlan, SubscriptionUpdate } from "./stripe.ts";

/** A user's Tripica Pro subscription, as last reported by Stripe webhooks. */
export interface Subscription {
  userId: string;
  customerId?: string;
  subscriptionId?: string;
  status?: string;
  plan?: ProPlan;
  /** Unix seconds. */
  trialEnd?: number | null;
  periodEnd?: number | null;
  /** True once the user has started a free trial (one per account). */
  trialUsed: boolean;
  /** Last update (ms), for refreshing from Stripe now and then. */
  updatedAt?: number;
}

/** Stripe statuses that keep Pro on (past_due: Stripe is retrying the card). */
const ACTIVE = new Set(["active", "trialing", "past_due"]);
export const isPro = (s: Subscription | undefined) => !!s?.status && ACTIVE.has(s.status);

export class SubscriptionStore {
  constructor(private db: SqlDb) {}

  get(userId: string): Subscription | undefined {
    const r = this.db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId) as
      | { user_id: string; customer_id: string | null; subscription_id: string | null; status: string | null; plan: string | null;
          trial_end: number | null; period_end: number | null; trial_used: number; updated_at: number }
      | undefined;
    if (!r) return undefined;
    return {
      userId: r.user_id,
      customerId: r.customer_id ?? undefined,
      subscriptionId: r.subscription_id ?? undefined,
      status: r.status ?? undefined,
      plan: (r.plan as ProPlan | null) ?? undefined,
      trialEnd: r.trial_end,
      periodEnd: r.period_end,
      trialUsed: r.trial_used === 1,
      updatedAt: r.updated_at,
    };
  }

  /** Merge a webhook update (missing fields keep their stored values). */
  apply(u: SubscriptionUpdate, now = Date.now()): Subscription {
    const cur = this.get(u.userId);
    const next: Subscription = {
      userId: u.userId,
      customerId: u.customerId ?? cur?.customerId,
      subscriptionId: u.subscriptionId ?? cur?.subscriptionId,
      status: u.status ?? cur?.status,
      plan: u.plan ?? cur?.plan,
      trialEnd: u.trialEnd !== undefined ? u.trialEnd : cur?.trialEnd ?? null,
      periodEnd: u.periodEnd !== undefined ? u.periodEnd : cur?.periodEnd ?? null,
      trialUsed: (cur?.trialUsed ?? false) || u.status === "trialing" || !!u.trialEnd,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO subscriptions (user_id, customer_id, subscription_id, status, plan, trial_end, period_end, trial_used, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET customer_id = excluded.customer_id, subscription_id = excluded.subscription_id,
           status = excluded.status, plan = excluded.plan, trial_end = excluded.trial_end, period_end = excluded.period_end,
           trial_used = excluded.trial_used, updated_at = excluded.updated_at`,
      )
      .run(next.userId, next.customerId ?? null, next.subscriptionId ?? null, next.status ?? null, next.plan ?? null,
        next.trialEnd ?? null, next.periodEnd ?? null, next.trialUsed ? 1 : 0, now);
    return next;
  }
}
