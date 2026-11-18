import { addDays, daysBetween } from "./dates.ts";
import { forecastFare, learnBookingCurve, type BookingCurve, type CurveSeries, type PriceVerdict } from "./forecast.ts";

/**
 * Backtest for the price forecast: replay each flight's real price history, predict as of past
 * dates using only data available then, and compare with what actually happened.
 *
 * - The booking curve for a test flight is learned from *other* flights only (k-fold), and only
 *   from their prices observed before the prediction date, so nothing leaks from the future.
 * - Accuracy is compared against the naive "price stays the same" forecast. A model that can't beat
 *   that isn't worth showing.
 */
export interface BacktestOptions {
  /** Make a prediction every N days of each flight's history. */
  stepDays?: number;
  /** Past prices required before a prediction is made. */
  minHistory?: number;
  /** Days ahead to score. */
  horizons?: number[];
  folds?: number;
}

export interface HorizonScore {
  days: number;
  /** Predictions scored at this horizon. */
  n: number;
  /** Mean absolute % error of the forecast. */
  mape: number;
  /** Same for "price stays the same". */
  naiveMape: number;
  /** Share of actual prices inside the predicted 80% range (well calibrated ≈ 0.8). */
  coverage: number;
}

export interface VerdictScore {
  n: number;
  /** Share of verdicts the later prices bore out ("wait": a ≥5% drop came; otherwise: it didn't). */
  hitRate: number;
}

export interface BacktestReport {
  flights: number;
  predictions: number;
  horizons: HorizonScore[];
  verdicts: Record<PriceVerdict, VerdictScore>;
  /** Mean absolute % error of "lowest predicted price" vs the actual lowest before departure. */
  lowestMape: number;
}

/** Price on a day, or the most recent price within 2 days before it. */
function priceOn(points: Map<string, number>, date: string): number | undefined {
  for (let back = 0; back <= 2; back++) {
    const p = points.get(addDays(date, -back));
    if (p !== undefined) return p;
  }
  return undefined;
}

function fold(i: number, folds: number) {
  return (i * 2654435761) % 4294967296 % folds;
}

export function backtestForecasts(series: CurveSeries[], opts: BacktestOptions = {}): BacktestReport {
  const step = opts.stepDays ?? 7;
  const minHistory = opts.minHistory ?? 14;
  const horizons = opts.horizons ?? [7, 14, 30];
  const folds = Math.max(2, opts.folds ?? 5);

  const flights = series
    .map((s, i) => {
      const pts = [...s.points].filter((p) => p.price > 0 && p.date <= s.departDate).sort((a, b) => a.date.localeCompare(b.date));
      return { i, departDate: s.departDate, pts, byDay: new Map(pts.map((p) => [p.date, p.price])) };
    })
    .filter((f) => f.pts.length >= minHistory + 2);

  // Curves are learned per (fold, prediction date) from other folds' prices seen before that date.
  const curves = new Map<string, BookingCurve>();
  const curveFor = (testFold: number, asOf: string) => {
    const key = `${testFold}|${asOf}`;
    let curve = curves.get(key);
    if (!curve) {
      const train = flights
        .filter((f) => fold(f.i, folds) !== testFold)
        .map((f) => ({ departDate: f.departDate, points: f.pts.filter((p) => p.date < asOf) }))
        .filter((s) => s.points.length >= 2);
      curve = learnBookingCurve(train);
      curves.set(key, curve);
    }
    return curve;
  };

  const acc = horizons.map((days) => ({ days, n: 0, err: 0, naive: 0, inside: 0 }));
  const verdicts: Record<PriceVerdict, { n: number; hits: number }> = { book: { n: 0, hits: 0 }, wait: { n: 0, hits: 0 }, steady: { n: 0, hits: 0 } };
  let predictions = 0;
  let lowestErr = 0;
  let lowestN = 0;

  for (const f of flights) {
    const testFold = fold(f.i, folds);
    const first = f.pts[0].date;
    // Prediction dates on a shared weekly grid (so curves can be reused across flights).
    const offset = ((daysBetween("2000-01-03", first) % step) + step) % step;
    for (let t = addDays(first, offset === 0 ? 0 : step - offset); daysBetween(t, f.departDate) >= 7; t = addDays(t, step)) {
      const history = f.pts.filter((p) => p.date < t);
      const price = priceOn(f.byDay, t);
      if (history.length < minHistory || price === undefined) continue;
      const future = f.pts.filter((p) => p.date > t);
      if (!future.length) continue;

      const trend = forecastFare({ price, today: t, departDate: f.departDate, history, curve: curveFor(testFold, t) });
      predictions++;

      for (const a of acc) {
        const target = addDays(t, a.days);
        if (target > f.departDate) continue;
        const actual = priceOn(f.byDay, target);
        const pred = trend.forecast[a.days - 1];
        if (actual === undefined || !pred) continue;
        a.n++;
        a.err += Math.abs(pred.price - actual) / actual;
        a.naive += Math.abs(price - actual) / actual;
        if (actual >= pred.low && actual <= pred.high) a.inside++;
      }

      const actualMin = Math.min(...future.map((p) => p.price));
      const v = verdicts[trend.verdict];
      v.n++;
      // One rule for every verdict: a "meaningful drop" is a later price at least 5% below today's.
      // "wait" is right when one happened; "book" and "steady" are right when none did.
      const dropped = actualMin <= price * 0.95;
      const hit = trend.verdict === "wait" ? dropped : !dropped;
      if (hit) v.hits++;
      lowestErr += Math.abs(Math.min(trend.lowest.price, price) - actualMin) / actualMin;
      lowestN++;
    }
  }

  const pct = (x: number, n: number) => (n ? x / n : NaN);
  return {
    flights: flights.length,
    predictions,
    horizons: acc.map((a) => ({ days: a.days, n: a.n, mape: pct(a.err, a.n), naiveMape: pct(a.naive, a.n), coverage: pct(a.inside, a.n) })),
    verdicts: {
      book: { n: verdicts.book.n, hitRate: pct(verdicts.book.hits, verdicts.book.n) },
      wait: { n: verdicts.wait.n, hitRate: pct(verdicts.wait.hits, verdicts.wait.n) },
      steady: { n: verdicts.steady.n, hitRate: pct(verdicts.steady.hits, verdicts.steady.n) },
    },
    lowestMape: pct(lowestErr, lowestN),
  };
}

/** Plain-text summary for the console. */
export function formatBacktest(r: BacktestReport): string {
  const p = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
  const lines = [
    `Flights: ${r.flights}   Predictions: ${r.predictions}`,
    "",
    "Horizon   n        Forecast error   'No change' error   Inside 80% range",
    ...r.horizons.map(
      (h) =>
        `${String(h.days).padStart(3)} days  ${String(h.n).padEnd(8)} ${p(h.mape).padEnd(16)} ${p(h.naiveMape).padEnd(19)} ${p(h.coverage)}`,
    ),
    "",
    "Verdict   n        Borne out by later prices",
    ...(["book", "wait", "steady"] as const).map((v) => `${v.padEnd(9)} ${String(r.verdicts[v].n).padEnd(8)} ${p(r.verdicts[v].hitRate)}`),
    "",
    `Lowest-price prediction error: ${p(r.lowestMape)}`,
  ];
  return lines.join("\n");
}
