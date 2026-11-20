import { createMockFlightProvider, createMockStayProvider } from "./providers/mock.ts";
import { createNoStayProvider } from "./providers/none.ts";
import { createSerpApiFlightProvider } from "./providers/serpapi-flights.ts";
import { createSerpApiStayProvider } from "./providers/serpapi-hotels.ts";
import { createTravelpayoutsFlightProvider } from "./providers/travelpayouts-flights.ts";
import type { FlightProvider, StayProvider } from "./providers/types.ts";
import { createStripe, type StripeClient } from "./stripe.ts";

/**
 * Settings from environment variables, shared by the Node server (process.env) and the Cloudflare
 * Worker (bindings and secrets). No Node-only imports.
 */
export type Env = Record<string, string | undefined>;

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export function settingsFromEnv(env: Env) {
  const provider = (env.PROVIDER ?? "mock").toLowerCase();
  if (provider !== "mock" && provider !== "serpapi" && provider !== "travelpayouts") {
    throw new Error(`PROVIDER must be "mock", "serpapi" or "travelpayouts", got "${provider}"`);
  }
  if (provider === "serpapi" && !env.SERPAPI_KEY) throw new Error("PROVIDER=serpapi requires SERPAPI_KEY");
  if (provider === "travelpayouts" && !env.TRAVELPAYOUTS_TOKEN) throw new Error("PROVIDER=travelpayouts requires TRAVELPAYOUTS_TOKEN");
  return {
    provider: provider as "mock" | "serpapi" | "travelpayouts",
    serpapiKey: env.SERPAPI_KEY ?? "",
    travelpayoutsToken: env.TRAVELPAYOUTS_TOKEN ?? "",
    travelpayoutsMarker: env.TRAVELPAYOUTS_MARKER ?? "",
    monthlyBudget: num(env.MONTHLY_QUERY_BUDGET, 100),
    dailyClientBudget: num(env.DAILY_CLIENT_BUDGET, 10),
    perSearchBudget: num(env.PER_SEARCH_BUDGET, 6),
    freeCallCap: num(env.FREE_CALL_CAP, 800),
    /** Cloudflare Turnstile secret: when set, routes that can spend live quota need a bot-check pass. */
    turnstileSecret: env.TURNSTILE_SECRET_KEY ?? "",
    /** Accounts (Clerk): set the secret key (or the PEM JWT key) to turn sign-in on. */
    clerkSecretKey: env.CLERK_SECRET_KEY ?? "",
    clerkJwtKey: env.CLERK_JWT_KEY ?? "",
    /** Site origins allowed to use sign-in tokens, comma-separated. */
    clerkAuthorizedParties: (env.CLERK_AUTHORIZED_PARTIES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    /** Live lookups per signed-in account per month (a search uses up to PER_SEARCH_BUDGET). */
    accountMonthlyBudget: num(env.ACCOUNT_MONTHLY_BUDGET, 50),
    /** Tripica Pro (Stripe). Billing turns on when the secret key, webhook secret and both price ids are set. */
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
    stripePriceMonthly: env.STRIPE_PRICE_MONTHLY ?? "",
    stripePriceYearly: env.STRIPE_PRICE_YEARLY ?? "",
    stripeAutomaticTax: env.STRIPE_AUTOMATIC_TAX === "true",
    trialDays: num(env.TRIAL_DAYS, 3),
    /** Live lookups per month for Pro subscribers, and during the free trial. */
    proMonthlyBudget: num(env.PRO_MONTHLY_BUDGET, 500),
    trialBudget: num(env.TRIAL_BUDGET, 100),
  };
}

export type Settings = ReturnType<typeof settingsFromEnv>;

export function providersFor(s: Settings): { flights: FlightProvider; stays: StayProvider } {
  const flights =
    s.provider === "serpapi"
      ? createSerpApiFlightProvider({ apiKey: s.serpapiKey })
      : s.provider === "travelpayouts"
        ? createTravelpayoutsFlightProvider({ token: s.travelpayoutsToken, marker: s.travelpayoutsMarker || undefined })
        : createMockFlightProvider();
  // Real flights never get paired with simulated hotel prices: without a lodging source the app
  // shows booking links instead.
  const stays =
    s.serpapiKey && s.provider !== "mock"
      ? createSerpApiStayProvider({ apiKey: s.serpapiKey })
      : s.provider === "mock"
        ? createMockStayProvider()
        : createNoStayProvider();
  return { flights, stays };
}

export interface BillingDeps {
  stripe: StripeClient;
  webhookSecret: string;
  prices: { monthly: string; yearly: string };
  proMonthlyBudget: number;
  trialBudget: number;
}

/** Stripe billing when fully configured, else undefined (no Pro plan). */
export function billingFor(s: Settings, fetchImpl?: typeof fetch): BillingDeps | undefined {
  if (!s.stripeSecretKey || !s.stripeWebhookSecret || !s.stripePriceMonthly || !s.stripePriceYearly) return undefined;
  return {
    stripe: createStripe({
      secretKey: s.stripeSecretKey,
      webhookSecret: s.stripeWebhookSecret,
      priceMonthly: s.stripePriceMonthly,
      priceYearly: s.stripePriceYearly,
      trialDays: s.trialDays,
      automaticTax: s.stripeAutomaticTax,
    }, fetchImpl),
    webhookSecret: s.stripeWebhookSecret,
    prices: { monthly: s.stripePriceMonthly, yearly: s.stripePriceYearly },
    proMonthlyBudget: s.proMonthlyBudget,
    trialBudget: s.trialBudget,
  };
}
