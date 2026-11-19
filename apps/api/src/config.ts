import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** apps/api, regardless of the process's working directory. */
const API_DIR = fileURLToPath(new URL("..", import.meta.url));

const num =(v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export function loadConfig(env = process.env) {
  const provider = (env.PROVIDER ?? "mock").toLowerCase();
  if (provider !== "mock" && provider !== "serpapi" && provider !== "travelpayouts") {
    throw new Error(`PROVIDER must be "mock", "serpapi" or "travelpayouts", got "${provider}"`);
  }
  if (provider === "serpapi" && !env.SERPAPI_KEY) throw new Error("PROVIDER=serpapi requires SERPAPI_KEY in apps/api/.env");
  if (provider === "travelpayouts" && !env.TRAVELPAYOUTS_TOKEN) throw new Error("PROVIDER=travelpayouts requires TRAVELPAYOUTS_TOKEN in apps/api/.env");
  return {
    provider: provider as "mock" | "serpapi" | "travelpayouts",
    serpapiKey: env.SERPAPI_KEY ?? "",
    travelpayoutsToken: env.TRAVELPAYOUTS_TOKEN ?? "",
    travelpayoutsMarker: env.TRAVELPAYOUTS_MARKER ?? "",
    monthlyBudget: num(env.MONTHLY_QUERY_BUDGET, 100),
    dailyClientBudget: num(env.DAILY_CLIENT_BUDGET, 10),
    perSearchBudget: num(env.PER_SEARCH_BUDGET, 6),
    freeCallCap: num(env.FREE_CALL_CAP, 800),
    port: num(env.PORT, 8787),
    dataDir: resolve(API_DIR, env.DATA_DIR ?? ".local-data"),
  };
}

export type Config = ReturnType<typeof loadConfig>;
