import { DurableObject } from "cloudflare:workers";
import type { Hono } from "hono";
import { createApi } from "../api.ts";
import { SCHEMA } from "../sql.ts";
import { providersFor, settingsFromEnv, type Env as SettingsEnv } from "../settings.ts";
import { doSql } from "./do-sql.ts";
import { turnstileGate, turnstileRoutes } from "../turnstile.ts";

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
      settings,
      flights,
      stays,
      // Cloudflare sets the visitor's IP; it travels with the request into the Durable Object.
      clientIp: (c) => c.req.header("cf-connecting-ip") ?? "unknown",
      liveGate: gate?.check,
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
    if (url.pathname.startsWith("/api/")) {
      // One global store keeps the shared cache and the monthly budget in one place.
      return env.STORE.get(env.STORE.idFromName("main")).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
