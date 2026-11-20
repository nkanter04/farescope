/**
 * Notices for when a live-search limit stops a lookup. Browser-safe (used by run.ts and details.ts).
 * "daily" is the per-visitor (IP) allowance, "account" a signed-in user's monthly allowance and
 * "monthly" the whole site's budget.
 */
export type LimitReason = "monthly" | "daily" | "account";

export function limitNotice(reason: LimitReason, opts: { signInHint?: boolean } = {}): string {
  if (reason === "monthly") return "This month's live search budget is used up. Showing cached prices.";
  if (reason === "account") return "You've used this month's live searches for your account. Showing cached prices.";
  return opts.signInHint
    ? "You've used today's free live searches. Showing cached prices. Sign in to get more each month."
    : "You've hit today's live search limit. Showing cached prices.";
}

/** Shorter form for a single lookup that found nothing cached. */
export function limitError(reason: LimitReason, opts: { signInHint?: boolean } = {}): string {
  if (reason === "monthly") return "This month's live search budget is used up.";
  if (reason === "account") return "You've used this month's live searches for your account.";
  return opts.signInHint ? "You've used today's free live searches. Sign in to get more each month." : "You've hit today's live search limit.";
}
