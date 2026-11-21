import { DurableObject } from "cloudflare:workers";
import type { Hono } from "hono";
import { createApi } from "../api.ts";
import { SCHEMA } from "../sql.ts";
import { billingFor, providersFor, settingsFromEnv, type Env as SettingsEnv } from "../settings.ts";
import { doSql } from "./do-sql.ts";
import { turnstileGate, turnstileRoutes } from "../turnstile.ts";
import { clerkVerifier } from "../auth.ts";

/**
 * Cloudflare entry point. Static files (the app and the guide pages) are served by Workers Static
 * Assets; only /api/* reaches this Worker, which hands it to one Durable Object that owns the
 * SQLite database (price cache, quota, trips, watches, price history).
 */
export interface Env {
  STORE: DurableObjectNamespace<TripicaStore>;
  ASSETS: Fetcher;
  PROVIDER?: string;
  SERPAPI_KEY?: string;
  TRAVELPAYOUTS_TOKEN?: string;
  TRAVELPAYOUTS_MARKER?: string;
  MONTHLY_QUERY_BUDGET?: string;
  DAILY_CLIENT_BUDGET?: string;
  PER_SEARCH_BUDGET?: string;
  TURNSTILE_SECRET_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  ACCOUNT_MONTHLY_BUDGET?: string;
  PER_PLAN_BUDGET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  STRIPE_AUTOMATIC_TAX?: string;
  STRIPE_PORTAL_CONFIG?: string;
  PRO_MONTHLY_BUDGET?: string;
  TRIAL_BUDGET?: string;
  TRIAL_DAYS?: string;
}

export class TripicaStore extends DurableObject<Env> {
  private app: Hono;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = doSql(ctx.storage);
    db.exec(SCHEMA);
    const settings = settingsFromEnv(env as unknown as SettingsEnv);
    const { flights, stays } = providersFor(settings);
    const gate = settings.turnstileSecret ? turnstileGate(settings.turnstileSecret) : undefined;
    this.app = createApi({
      db,
      settings: { ...settings, siteOrigins: settings.clerkAuthorizedParties },
      billing: billingFor(settings),
      flights,
      stays,
      // Cloudflare sets the visitor's IP; it travels with the request into the Durable Object.
      clientIp: (c) => c.req.header("cf-connecting-ip") ?? "unknown",
      liveGate: gate?.check,
      verifyUser: clerkVerifier({
        secretKey: settings.clerkSecretKey,
        jwtKey: settings.clerkJwtKey,
        authorizedParties: settings.clerkAuthorizedParties,
      }),
      extend: gate ? (app) => turnstileRoutes(app, gate) : undefined,
      log: (message, error) => console.error(message, error),
    });
  }

  override fetch(request: Request): Promise<Response> {
    return Promise.resolve(this.app.fetch(request));
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const click = /^\/api\/booking-click\/(app|guide)\/(flight|stay|hostel|activity|car)$/.exec(url.pathname);
    if (click && request.method === "POST") {
      if (request.headers.get("origin") !== url.origin) return new Response(null, { status: 403 });
      console.info("booking_click", { source: click[1], kind: click[2] });
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith("/api/")) {
      // Pass the visitor's approximate location (from Cloudflare, never from the client) for
      // /api/locate; strip any client-sent copy.
      const headers = new Headers(request.headers);
      headers.delete("x-visitor-geo");
      const { latitude, longitude } = (request.cf ?? {}) as { latitude?: string; longitude?: string };
      if (latitude && longitude) headers.set("x-visitor-geo", `${latitude},${longitude}`);
      // One global store keeps the shared cache and the monthly budget in one place.
      return env.STORE.get(env.STORE.idFromName("main")).fetch(new Request(request, { headers }));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
