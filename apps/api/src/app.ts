import { join } from "node:path";
import type { Context } from "hono";
import type { IncomingMessage } from "node:http";
import { createApi } from "./api.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db.ts";
import type { FlightProvider, StayProvider } from "./providers/types.ts";
import { billingFor, providersFor } from "./settings.ts";
import { clerkVerifier } from "./auth.ts";

export interface AppOverrides {
  flights?: FlightProvider;
  stays?: StayProvider;
  dbPath?: string;
  /** Sign-in check override (tests). */
  verifyUser?: (token: string) => Promise<string | undefined>;
  /** Stripe fetch override (tests). */
  stripeFetch?: typeof fetch;
}

/** The caller's IP under @hono/node-server (local dev sits behind the Vite proxy on localhost). */
function nodeIp(c: Context): string {
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || incoming?.socket.remoteAddress || "local";
}

/** The API for Node: local dev server and tests. Production runs the same routes on Cloudflare. */
export function buildApp(cfg: Config, overrides: AppOverrides = {}) {
  const db = openDb(overrides.dbPath ?? join(cfg.dataDir, "farescope.sqlite"));
  const providers = providersFor(cfg);
  const app = createApi({
    db,
    settings: { ...cfg, siteOrigins: cfg.clerkAuthorizedParties },
    flights: overrides.flights ?? providers.flights,
    stays: overrides.stays ?? providers.stays,
    clientIp: nodeIp,
    // Local only: lets you trigger the weekly alert check with
    //   curl -X POST -H "x-tripica-cron: 1" localhost:8787/api/internal/alerts-run
    internalCron: true,
    verifyUser: overrides.verifyUser ??
      clerkVerifier({ secretKey: cfg.clerkSecretKey, jwtKey: cfg.clerkJwtKey, authorizedParties: cfg.clerkAuthorizedParties }),
    billing: billingFor(cfg, overrides.stripeFetch),
    log: (message, error) => console.error(message, error),
  });
  return Object.assign(app, { close: () => db.close() });
}
