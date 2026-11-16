import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const cfg = loadConfig();
const app = buildApp(cfg);

app.listen({ port: cfg.port, host: "127.0.0.1" }).then(() => {
  app.log.info(`farescope api on :${cfg.port} (provider=${cfg.provider}, monthly budget=${cfg.monthlyBudget})`);
});
