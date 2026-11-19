import { serve } from "@hono/node-server";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const cfg = loadConfig();
const app = buildApp(cfg);

serve({ fetch: app.fetch, port: cfg.port, hostname: "127.0.0.1" }, () => {
  console.log(`farescope api on :${cfg.port} (provider=${cfg.provider}, monthly budget=${cfg.monthlyBudget})`);
});
