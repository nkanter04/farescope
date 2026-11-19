import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { settingsFromEnv } from "./settings.ts";

/** apps/api, regardless of the process's working directory. */
const API_DIR = fileURLToPath(new URL("..", import.meta.url));

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

/** Node server config: the shared settings plus local-only options (port, data directory). */
export function loadConfig(env = process.env) {
  return {
    ...settingsFromEnv(env),
    port: num(env.PORT, 8787),
    dataDir: resolve(API_DIR, env.DATA_DIR ?? ".local-data"),
  };
}

export type Config = ReturnType<typeof loadConfig>;
