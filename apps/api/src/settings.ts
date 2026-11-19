import { createMockFlightProvider, createMockStayProvider } from "./providers/mock.ts";
import { createNoStayProvider } from "./providers/none.ts";
import { createSerpApiFlightProvider } from "./providers/serpapi-flights.ts";
import { createSerpApiStayProvider } from "./providers/serpapi-hotels.ts";
import { createTravelpayoutsFlightProvider } from "./providers/travelpayouts-flights.ts";
import type { FlightProvider, StayProvider } from "./providers/types.ts";

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
