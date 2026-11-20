/**
 * One-time Stripe setup for Tripica Pro. Creates (or reuses) the product and its two prices, the
 * customer portal settings, and optionally the webhook endpoint, then writes the IDs into
 * apps/api/.env. Safe to run again: prices are found by lookup key.
 *
 *   npx tsx scripts/stripe-setup.ts                          # test mode (sk_test_ key in apps/api/.env)
 *   npx tsx scripts/stripe-setup.ts --webhook https://<site>/api/billing/webhook
 *   npx tsx scripts/stripe-setup.ts --live                   # only with a live key, on purpose
 *
 * Prices must match apps/web/src/pro.ts ($8.99/month, $79/year).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV = fileURLToPath(new URL("../apps/api/.env", import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args[args.indexOf(`--${name}`) + 1];

const envText = readFileSync(ENV, "utf8");
const key = /^STRIPE_SECRET_KEY=(.*)$/m.exec(envText)?.[1]?.trim() ?? "";
if (!key) throw new Error("Put STRIPE_SECRET_KEY in apps/api/.env first.");
if (key.startsWith("sk_live_") && !flag("live")) throw new Error("That's a live key. Re-run with --live if you really mean to set up real payments.");

async function stripe(method: "GET" | "POST", path: string, params?: Record<string, string>) {
  const qs = params ? new URLSearchParams(params) : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && qs ? `?${qs}` : ""}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? qs : undefined,
  });
  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(`${path}: ${json.error?.message ?? res.status}`);
  return json;
}

const PRICES = [
  { lookup: "tripica_pro_monthly", amount: "899", interval: "month", env: "STRIPE_PRICE_MONTHLY" },
  { lookup: "tripica_pro_yearly", amount: "7900", interval: "year", env: "STRIPE_PRICE_YEARLY" },
] as const;

const found = (await stripe("GET", "prices", { "lookup_keys[0]": PRICES[0].lookup, "lookup_keys[1]": PRICES[1].lookup, active: "true" })).data as { id: string; lookup_key: string; product: string }[];
let productId = found[0]?.product;
if (!productId) {
  const product = await stripe("POST", "products", { name: "Tripica Pro", description: "More live price searches on Tripica: 500 a month." });
  productId = String(product.id);
  console.log(`Created product ${productId}`);
}
const ids: Record<string, string> = {};
for (const p of PRICES) {
  const existing = found.find((f) => f.lookup_key === p.lookup);
  if (existing) {
    ids[p.env] = existing.id;
    continue;
  }
  const price = await stripe("POST", "prices", {
    product: productId, currency: "usd", unit_amount: p.amount, "recurring[interval]": p.interval, lookup_key: p.lookup,
    tax_behavior: "exclusive",
  });
  ids[p.env] = String(price.id);
  console.log(`Created ${p.interval}ly price ${price.id}`);
}

// Customer portal: update card, see invoices, cancel at period end, switch between the two prices.
const portal = await stripe("POST", "billing_portal/configurations", {
  "business_profile[headline]": "Manage your Tripica Pro subscription",
  "features[payment_method_update][enabled]": "true",
  "features[invoice_history][enabled]": "true",
  "features[subscription_cancel][enabled]": "true",
  "features[subscription_cancel][mode]": "at_period_end",
  "features[subscription_update][enabled]": "true",
  "features[subscription_update][default_allowed_updates][0]": "price",
  "features[subscription_update][products][0][product]": productId,
  "features[subscription_update][products][0][prices][0]": ids.STRIPE_PRICE_MONTHLY,
  "features[subscription_update][products][0][prices][1]": ids.STRIPE_PRICE_YEARLY,
  default_return_url: "https://tripica.farescope.workers.dev/app/",
}).catch((e: Error) => ({ error: e.message }));
if ("error" in portal) console.log(`Portal settings not changed: ${portal.error}`);
else {
  ids.STRIPE_PORTAL_CONFIG = String(portal.id);
  console.log("Customer portal configured.");
}

if (flag("webhook")) {
  const url = value("webhook");
  if (!url?.startsWith("https://")) throw new Error("--webhook needs an https URL ending in /api/billing/webhook");
  const events = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
  const params: Record<string, string> = { url, description: "Tripica Pro" };
  events.forEach((e, i) => (params[`enabled_events[${i}]`] = e));
  const endpoint = await stripe("POST", "webhook_endpoints", params);
  ids.STRIPE_WEBHOOK_SECRET = String(endpoint.secret);
  console.log(`Created webhook endpoint for ${url} (secret saved to apps/api/.env, not printed).`);
}

let text = envText;
for (const [name, val] of Object.entries(ids)) {
  text = new RegExp(`^${name}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${val}`) : `${text.trimEnd()}\n${name}=${val}\n`;
}
writeFileSync(ENV, text);
console.log(`Saved ${Object.keys(ids).join(", ")} to apps/api/.env.`);
console.log(`Monthly price: ${ids.STRIPE_PRICE_MONTHLY}  Yearly price: ${ids.STRIPE_PRICE_YEARLY}`);
