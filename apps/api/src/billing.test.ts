import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { inject } from "./test-inject.ts";
import { verifyStripeSignature } from "./stripe.ts";

const WHSEC = "whsec_test_secret";
const TOKEN = "a-valid-session-token-for-user-1";
const auth = { authorization: `Bearer ${TOKEN}`, origin: "http://localhost:5180" };

async function sign(payload: string, t: number, secret = WHSEC) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  return `t=${t},v1=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function setup() {
  const stripeCalls: { url: string; body: URLSearchParams }[] = [];
  const stripeFetch = (async (url: string, init?: RequestInit) => {
    stripeCalls.push({ url, body: new URLSearchParams(String(init?.body)) });
    if (url.includes("/checkout/sessions/cs_")) {
      return new Response(JSON.stringify({
        client_reference_id: url.includes("cs_other") ? "user_2" : "user_1", customer: "cus_9",
        subscription: { id: "sub_9", status: "trialing", trial_end: 1790000000, items: { data: [{ price: { id: "price_y" }, current_period_end: 1800000000 }] } },
      }));
    }
    return new Response(JSON.stringify({ url: url.includes("billing_portal") ? "https://billing.stripe.test/p" : "https://checkout.stripe.test/c" }));
  }) as unknown as typeof fetch;
  const cfg = loadConfig({
    PROVIDER: "mock", ACCOUNT_MONTHLY_BUDGET: "50", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_MONTHLY: "price_m", STRIPE_PRICE_YEARLY: "price_y", PRO_MONTHLY_BUDGET: "500", TRIAL_BUDGET: "100",
  } as NodeJS.ProcessEnv);
  const app = buildApp(cfg, { dbPath: ":memory:", verifyUser: async (t) => (t === TOKEN ? "user_1" : undefined), stripeFetch });
  const event = async (type: string, object: object) => {
    const payload = JSON.stringify({ type, data: { object } });
    return inject(app, { method: "POST", url: "/api/billing/webhook", headers: { "stripe-signature": await sign(payload, Math.floor(Date.now() / 1000)) }, payload: JSON.parse(payload) });
  };
  return { app, stripeCalls, event };
}

const sub = (status: string, price = "price_m", extra: object = {}) => ({
  id: "sub_1", customer: "cus_1", status, metadata: { user_id: "user_1" }, items: { data: [{ price: { id: price }, current_period_end: 1800000000 }] }, ...extra,
});

describe("stripe webhook signatures", () => {
  it("accepts Stripe's signature and rejects forged or old ones", async () => {
    const t = 1_800_000_000;
    expect(await verifyStripeSignature("{}", await sign("{}", t), WHSEC, t)).toBe(true);
    expect(await verifyStripeSignature("{}", await sign("{}", t, "whsec_other"), WHSEC, t)).toBe(false);
    expect(await verifyStripeSignature('{"a":1}', await sign("{}", t), WHSEC, t)).toBe(false);
    expect(await verifyStripeSignature("{}", await sign("{}", t), WHSEC, t + 600)).toBe(false);
    expect(await verifyStripeSignature("{}", undefined, WHSEC, t)).toBe(false);
  });
});

describe("Tripica Pro", () => {
  it("activates Pro right after checkout by confirming the session with Stripe", async () => {
    const { app } = setup();
    const res = await inject(app, { method: "POST", url: "/api/billing/sync", headers: auth, payload: { sessionId: "cs_test_abcdefgh123" } });
    expect(res.json()).toEqual({ pro: true, status: "trialing" });
    expect((await inject(app, { url: "/api/billing", headers: auth })).json()).toMatchObject({ plan: "yearly", canManage: true, canTrial: false });
    // Someone else's checkout session can't be claimed.
    const other = await inject(app, { method: "POST", url: "/api/billing/sync", headers: auth, payload: { sessionId: "cs_other_abcdefgh" } });
    expect(other.statusCode).toBe(403);
  });

  it("starts checkout with a card-required trial, only for signed-in users on our own sites", async () => {
    const { app, stripeCalls } = setup();
    expect((await inject(app, { method: "POST", url: "/api/billing/checkout", payload: { plan: "monthly" } })).statusCode).toBe(401);
    expect((await inject(app, { method: "POST", url: "/api/billing/checkout", headers: { ...auth, origin: "https://evil.example" }, payload: { plan: "monthly" } })).statusCode).toBe(400);
    const res = await inject(app, { method: "POST", url: "/api/billing/checkout", headers: auth, payload: { plan: "yearly" } });
    expect(res.json()).toEqual({ url: "https://checkout.stripe.test/c" });
    const body = Object.fromEntries(stripeCalls[0].body);
    expect(stripeCalls[0].url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(body).toMatchObject({
      mode: "subscription", "line_items[0][price]": "price_y", client_reference_id: "user_1", "subscription_data[metadata][user_id]": "user_1",
      payment_method_collection: "always", "subscription_data[trial_period_days]": "3",
      success_url: "http://localhost:5180/app/?pro=welcome&session_id={CHECKOUT_SESSION_ID}",
    });
  });

  it("follows the subscription through webhooks: trial allowance, Pro allowance, then back to free", async () => {
    const { app, event, stripeCalls } = setup();
    const quota = async () => (await inject(app, { url: "/api/quota", headers: auth })).json();
    expect(await quota()).toMatchObject({ billing: true, pro: false, clientBudget: 50 });

    expect((await event("checkout.session.completed", { client_reference_id: "user_1", customer: "cus_1", subscription: "sub_1" })).statusCode).toBe(200);
    expect((await event("customer.subscription.created", sub("trialing", "price_m", { trial_end: 1790000000 }))).statusCode).toBe(200);
    expect(await quota()).toMatchObject({ pro: true, clientBudget: 100 });
    const billing = (await inject(app, { url: "/api/billing", headers: auth })).json();
    expect(billing).toMatchObject({ pro: true, status: "trialing", plan: "monthly", canTrial: false, canManage: true, periodEnd: 1800000000 });

    await event("customer.subscription.updated", sub("active"));
    expect(await quota()).toMatchObject({ pro: true, clientBudget: 500 });
    // Already Pro: no second checkout. The portal opens for the stored customer.
    expect((await inject(app, { method: "POST", url: "/api/billing/checkout", headers: auth, payload: { plan: "monthly" } })).statusCode).toBe(409);
    expect((await inject(app, { method: "POST", url: "/api/billing/portal", headers: auth })).json()).toEqual({ url: "https://billing.stripe.test/p" });
    expect(Object.fromEntries(stripeCalls.at(-1)!.body)).toMatchObject({ customer: "cus_1", return_url: "http://localhost:5180/app/" });

    await event("customer.subscription.deleted", sub("canceled"));
    expect(await quota()).toMatchObject({ pro: false, clientBudget: 50 });
    // The free trial is used up: a new checkout has no trial.
    await inject(app, { method: "POST", url: "/api/billing/checkout", headers: auth, payload: { plan: "monthly" } });
    const again = Object.fromEntries(stripeCalls.at(-1)!.body);
    expect(again["subscription_data[trial_period_days]"]).toBeUndefined();
    expect(again.customer).toBe("cus_1");
  });

  it("rejects webhooks without a valid signature and stays off when Stripe isn't configured", async () => {
    const { app } = setup();
    const res = await inject(app, { method: "POST", url: "/api/billing/webhook", headers: { "stripe-signature": "t=1,v1=00" }, payload: { type: "customer.subscription.created" } });
    expect(res.statusCode).toBe(400);
    const plain = buildApp(loadConfig({ PROVIDER: "mock" } as NodeJS.ProcessEnv), { dbPath: ":memory:", verifyUser: async () => "user_1" });
    expect((await inject(plain, "/api/billing")).json()).toEqual({ enabled: false });
    expect((await inject(plain, "/api/quota")).json()).toMatchObject({ billing: false });
  });
});
