/**
 * How accurate are Tripica's price predictions? Replays price histories, predicts as of past
 * dates using only data available then, and compares with what actually happened.
 *
 *   npm run backtest                      # real prices from the local price_history table if there
 *                                         # are enough, otherwise simulated demo flights
 *   npm run backtest -- --source mock --flights 300
 *   npm run backtest -- --source db --db apps/api/.local-data/farescope.sqlite
 *
 * Read the results honestly: on simulated data the model is partly grading itself (the demo
 * generates prices from a booking curve, which is what the model learns). Only real prices from
 * live searches (price_history) say how well it predicts real fares.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addDays, backtestForecasts, formatBacktest, type CurveSeries } from "@farescope/shared";
import { openDb } from "../apps/api/src/db.ts";
import { PriceHistory } from "../apps/api/src/history.ts";
import { createMockFlightProvider, mockPriceHistory } from "../apps/api/src/providers/mock.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = fileURLToPath(new URL("..", import.meta.url));
const dbPath = arg("db") ?? `${root}apps/api/.local-data/farescope.sqlite`;
const MIN_REAL_SERIES = 30;

function realSeries(): CurveSeries[] {
  if (!existsSync(dbPath)) return [];
  const db = openDb(dbPath);
  try {
    // Scoped observations first; older unscoped rows still count for the backtest.
    const history = new PriceHistory(db);
    const scoped = history.series(5000);
    return scoped.length >= MIN_REAL_SERIES ? scoped : [...scoped, ...history.legacySeries(5000)];
  } finally {
    db.close();
  }
}

/** Simulated flights with complete price paths from going on sale to departure. */
async function mockSeries(count: number): Promise<CurveSeries[]> {
  const hubs = ["AUS", "JFK", "LAX", "ORD", "MIA", "SEA", "LHR", "CDG", "FRA", "NRT", "ICN", "SIN", "SYD", "GRU", "MEX", "DXB"];
  const out: CurveSeries[] = [];
  for (let i = 0; out.length < count && i < count * 4; i++) {
    const from = hubs[i % hubs.length];
    const to = hubs[(i * 7 + 3) % hubs.length];
    if (from === to) continue;
    const departDate = addDays("2026-06-01", (i * 5) % 360);
    // Price on departure day; the history then walks back to the day it went on sale.
    const provider = createMockFlightProvider({ today: () => departDate });
    const { fares } = await provider.search({
      origins: [from], destinations: [to], departDate, returnDate: addDays(departDate, 7), cabin: "economy", maxStops: null, adults: 1,
    });
    const fare = fares[0];
    if (!fare) continue;
    out.push({ departDate, points: [...mockPriceHistory(fare, departDate), { date: departDate, price: fare.price }] });
  }
  return out;
}

const requested = arg("source");
let source = requested ?? "auto";
let series: CurveSeries[] = [];
if (source !== "mock") {
  series = realSeries();
  if (source === "auto") source = series.length >= MIN_REAL_SERIES ? "db" : "mock";
}
if (source === "mock") series = await mockSeries(Number(arg("flights") ?? 200));

if (!series.length) {
  console.log(`No usable price history in ${dbPath}. Run live searches first, or use --source mock.`);
  process.exit(1);
}

console.log(
  source === "db"
    ? `Backtesting on REAL prices from ${dbPath} (${series.length} flights).`
    : `Backtesting on SIMULATED demo flights (${series.length}). The demo generates prices from a booking curve, ` +
        `so this mostly checks the pipeline. Real accuracy needs real price history.` +
        (requested ? "" : ` (Only ${realSeries().length} real flights recorded so far; need ${MIN_REAL_SERIES}.)`),
);
const started = Date.now();
const report = backtestForecasts(series);
console.log(`\n${formatBacktest(report)}\n\n(${((Date.now() - started) / 1000).toFixed(1)}s)`);
