/**
 * Stripe, talked to directly over its REST API with fetch and Web Crypto: no SDK, so it runs the
 * same on Node and Cloudflare Workers. Covers what Tripica Pro needs: Checkout (subscription with a
 * card-required free trial), the customer portal (manage/cancel), and webhook signature checks.
 */
export interface StripeSettings {
  secretKey: string;
  webhookSecret: string;
  priceMonthly: string;
  priceYearly: string;
  trialDays: number;
  /** Let Stripe Tax compute sales tax (needs Stripe Tax turned on in the dashboard). */
  automaticTax?: boolean;
  /** Customer portal configuration (from scripts/stripe-setup.ts); else Stripe's default. */
  portalConfig?: string;
}

export type ProPlan = "monthly" | "yearly";

export interface StripeClient {
  checkout(o: { userId: string; plan: ProPlan; customerId?: string; email?: string; trial: boolean; origin: string }): Promise<string>;
  portal(o: { customerId: string; origin: string }): Promise<string>;
  /** A finished checkout's subscription (for activating Pro the moment the browser returns). */
  checkoutResult(sessionId: string): Promise<SubscriptionUpdate | undefined>;
  /** The current state of a subscription (catches renewals and cancellations without webhooks). */
  subscription(subscriptionId: string): Promise<SubscriptionUpdate | undefined>;
}

const API = "https://api.stripe.com/v1";

export function createStripe(s: StripeSettings, fetchImpl: typeof fetch = fetch): StripeClient {
  const post = async (path: string, params: URLSearchParams): Promise<Record<string, unknown>> => {
    const res = await fetchImpl(`${API}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${s.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `Stripe HTTP ${res.status}`);
    return json;
  };
  const get = async (path: string): Promise<Record<string, unknown>> => {
    const res = await fetchImpl(`${API}/${path}`, { headers: { authorization: `Bearer ${s.secretKey}` } });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `Stripe HTTP ${res.status}`);
    return json;
  };
  const prices = { monthly: s.priceMonthly, yearly: s.priceYearly };
  return {
    async checkoutResult(sessionId) {
      if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(sessionId)) return undefined;
      const session = await get(`checkout/sessions/${sessionId}?expand[]=subscription`);
      const userId = str(session.client_reference_id);
      const subscription = obj(session.subscription);
      if (!userId || !subscription.id) return undefined;
      const u = fromSubscription({ ...subscription, metadata: { user_id: userId } }, prices, "customer.subscription.updated");
      return u ? { ...u, customerId: str(session.customer) ?? u.customerId } : undefined;
    },
    async subscription(subscriptionId) {
      if (!/^sub_[A-Za-z0-9_]{8,200}$/.test(subscriptionId)) return undefined;
      return fromSubscription(await get(`subscriptions/${subscriptionId}`), prices, "customer.subscription.updated");
    },
    async checkout(o) {
      const p = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": o.plan === "yearly" ? s.priceYearly : s.priceMonthly,
        "line_items[0][quantity]": "1",
        client_reference_id: o.userId,
        "subscription_data[metadata][user_id]": o.userId,
        "metadata[user_id]": o.userId,
        // Card required up front, also during the trial (stops endless free trials).
        payment_method_collection: "always",
        allow_promotion_codes: "true",
        // Stripe fills in {CHECKOUT_SESSION_ID}; the app confirms the purchase with it on return.
        success_url: `${o.origin}/app/?pro=welcome&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${o.origin}/app/?pro=cancelled`,
      });
      if (o.trial && s.trialDays > 0) p.set("subscription_data[trial_period_days]", String(s.trialDays));
      if (o.customerId) p.set("customer", o.customerId);
      else if (o.email) p.set("customer_email", o.email);
      if (s.automaticTax) p.set("automatic_tax[enabled]", "true");
      const session = await post("checkout/sessions", p);
      if (typeof session.url !== "string") throw new Error("Stripe did not return a checkout link.");
      return session.url;
    },
    async portal(o) {
      const params = new URLSearchParams({ customer: o.customerId, return_url: `${o.origin}/app/` });
      if (s.portalConfig) params.set("configuration", s.portalConfig);
      const session = await post("billing_portal/sessions", params);
      if (typeof session.url !== "string") throw new Error("Stripe did not return a portal link.");
      return session.url;
    },
  };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Constant-time string comparison. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Stripe's webhook signature: HMAC-SHA256 of "<t>.<payload>", within 5 minutes of now. */
export async function verifyStripeSignature(payload: string, header: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((kv) => kv.split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || !signatures.length || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return signatures.some((sig) => same(sig, expected));
}

/** What a webhook event says about a user's subscription. */
export interface SubscriptionUpdate {
  userId: string;
  customerId?: string;
  subscriptionId?: string;
  status?: string;
  plan?: ProPlan;
  trialEnd?: number | null;
  periodEnd?: number | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : null);

export function subscriptionUpdate(event: unknown, prices: { monthly: string; yearly: string }): SubscriptionUpdate | undefined {
  const e = obj(event);
  const type = str(e.type) ?? "";
  const o = obj(obj(e.data).object);
  if (type === "checkout.session.completed") {
    const userId = str(o.client_reference_id) ?? str(obj(o.metadata).user_id);
    if (!userId) return undefined;
    return { userId, customerId: str(o.customer), subscriptionId: str(o.subscription) };
  }
  if (type.startsWith("customer.subscription.")) return fromSubscription(o, prices, type);
  return undefined;
}

/** A Stripe subscription object -> what Tripica stores (user from its metadata). */
function fromSubscription(o: Obj, prices: { monthly: string; yearly: string }, type: string): SubscriptionUpdate | undefined {
  const userId = str(obj(o.metadata).user_id);
  if (!userId) return undefined;
  const item = obj((obj(o.items).data as unknown[] | undefined)?.[0]);
  const price = str(obj(item.price).id);
  return {
    userId,
    customerId: str(o.customer),
    subscriptionId: str(o.id),
    status: type === "customer.subscription.deleted" ? "canceled" : str(o.status),
    plan: price === prices.yearly ? "yearly" : price === prices.monthly ? "monthly" : undefined,
    trialEnd: num(o.trial_end),
    // Newer Stripe API versions keep the period end on the subscription item.
    periodEnd: num(o.current_period_end) ?? num(item.current_period_end),
  };
}
