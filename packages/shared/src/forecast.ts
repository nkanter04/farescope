import { addDays, daysBetween } from "./dates.ts";

/**
 * Price prediction for one flight (route + travel dates), learned from price data rather than a
 * fixed rule. Pure and browser-safe: the API server and the in-browser demo share it.
 *
 * 1. A **booking curve** says how prices typically move with days before departure. It is learned
 *    from previous flights' price series and blended with a prior while data is thin.
 * 2. This flight's **level** is fitted from its own price history, divided out by the curve.
 * 3. The **forecast** follows the curve from today to departure. Today's price reverts toward the
 *    fitted level, inside an uncertainty band that widens with time.
 *
 * It is an estimate, not a guarantee: the UI always says how much data it used.
 */

/** A price quoted on a given day for the same flight/search. */
export interface PricePoint {
  /** Day the price was observed (YYYY-MM-DD). */
  date: string;
  price: number;
}

/** A previous flight's price history, used to learn the booking curve. */
export interface CurveSeries {
  departDate: string;
  points: PricePoint[];
}

/** Days-before-departure bins: 0–6, 7–13, 14–20, 21–44, 45–89, 90–179, 180+. */
export const CURVE_BIN_EDGES = [7, 14, 21, 45, 90, 180] as const;
/** Representative days-out per bin, used to interpolate a smooth curve. */
const BIN_CENTERS = [3, 10, 17, 32, 67, 134, 250];
/**
 * Prior shape when there is little data: the cheapest window is about 1–3 months out, prices
 * climb steeply in the last three weeks, and fares far out sit slightly above the low.
 */
export const PRIOR_CURVE = [1.45, 1.22, 1.1, 1.0, 0.95, 0.98, 1.06];
/** Observations per bin needed before learned data and the prior get equal weight. */
const PRIOR_STRENGTH = 20;

export interface BookingCurve {
  multipliers: number[];
  /** Observations behind each bin (0 = prior only). */
  observations: number[];
  /** Number of previous-flight series the curve learned from. */
  series: number;
}

export const PRIOR_BOOKING_CURVE: BookingCurve = {
  multipliers: [...PRIOR_CURVE],
  observations: PRIOR_CURVE.map(() => 0),
  series: 0,
};

export function curveBin(daysOut: number): number {
  const i = CURVE_BIN_EDGES.findIndex((edge) => daysOut < edge);
  return i === -1 ? CURVE_BIN_EDGES.length : i;
}

/** Smooth multiplier at any days-out, interpolating between bin centers. */
export function curveAt(curve: BookingCurve, daysOut: number): number {
  const m = curve.multipliers;
  const d = Math.max(0, daysOut);
  if (d <= BIN_CENTERS[0]) return m[0];
  for (let i = 1; i < BIN_CENTERS.length; i++) {
    if (d <= BIN_CENTERS[i]) {
      const t = (d - BIN_CENTERS[i - 1]) / (BIN_CENTERS[i] - BIN_CENTERS[i - 1]);
      return m[i - 1] + t * (m[i] - m[i - 1]);
    }
  }
  return m[m.length - 1];
}

/**
 * Learn the curve from previous flights. Each series is normalized by its own average, then
 * re-expressed on the prior's scale, so series covering different windows can be combined.
 */
export function learnBookingCurve(series: CurveSeries[], prior: number[] = PRIOR_CURVE): BookingCurve {
  const sums = prior.map(() => 0);
  const counts = prior.map(() => 0);
  let used = 0;
  for (const s of series) {
    const pts = s.points
      .map((p) => ({ price: p.price, daysOut: daysBetween(p.date, s.departDate) }))
      .filter((p) => p.price > 0 && p.daysOut >= 0 && Number.isFinite(p.price));
    if (pts.length < 2) continue;
    used++;
    const meanLog = pts.reduce((sum, p) => sum + Math.log(p.price), 0) / pts.length;
    const priorMeanLog = pts.reduce((sum, p) => sum + Math.log(prior[curveBin(p.daysOut)]), 0) / pts.length;
    for (const p of pts) {
      const bin = curveBin(p.daysOut);
      sums[bin] += Math.log(p.price) - meanLog + priorMeanLog;
      counts[bin]++;
    }
  }
  const multipliers = prior.map((pm, i) => {
    if (!counts[i]) return pm;
    const learned = Math.exp(sums[i] / counts[i]);
    const w = counts[i] / (counts[i] + PRIOR_STRENGTH);
    return w * learned + (1 - w) * pm;
  });
  return { multipliers, observations: counts, series: used };
}

export type PriceVerdict = "book" | "wait" | "steady";
export type PriceLevel = "low" | "typical" | "high";

export interface ForecastPoint {
  date: string;
  /** Most likely price. */
  price: number;
  /** 80% band. */
  low: number;
  high: number;
}

export interface PriceTrend {
  today: string;
  departDate: string;
  currentPrice: number;
  /** Past prices for this flight (oldest first), ending with today's price. */
  history: PricePoint[];
  /** Day-by-day forecast from tomorrow to departure. */
  forecast: ForecastPoint[];
  /** Lowest predicted price between now and takeoff (today's price if nothing lower). */
  lowest: { date: string; price: number };
  average: number;
  typicalRange: [number, number];
  level: PriceLevel;
  verdict: PriceVerdict;
  basis: {
    historyPoints: number;
    curveSeries: number;
    curveObservations: number;
    simulated: boolean;
  };
}

function weightedMedian(items: { value: number; weight: number }[]): number {
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return sorted[sorted.length - 1].value;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface ForecastInput {
  price: number;
  today: string;
  departDate: string;
  history: PricePoint[];
  curve: BookingCurve;
  simulated?: boolean;
}

/** Predict the path of one flight's price from today until departure. */
export function forecastFare(input: ForecastInput): PriceTrend {
  const { price, today, departDate, curve } = input;
  const daysNow = Math.max(0, daysBetween(today, departDate));
  // One price per day (the lowest), only from before today, with today's price last.
  const byDay = new Map<string, number>();
  for (const p of input.history) {
    if (p.date >= today || p.date > departDate || !(p.price > 0)) continue;
    byDay.set(p.date, Math.min(byDay.get(p.date) ?? Infinity, p.price));
  }
  const history: PricePoint[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, p]) => ({ date, price: p }));
  history.push({ date: today, price });

  // This flight's level: each observation divided by the curve, recent ones weighted more.
  const obs = history.map((p) => {
    const age = daysBetween(p.date, today);
    const c = curveAt(curve, daysBetween(p.date, departDate));
    return { value: p.price / c, weight: (p.date === today ? 3 : 1) * 0.5 ** (age / 21), c, price: p.price };
  });
  const level = weightedMedian(obs);
  const totalW = obs.reduce((s, o) => s + o.weight, 0);
  const resid = Math.sqrt(obs.reduce((s, o) => s + o.weight * Math.log(o.price / (level * o.c)) ** 2, 0) / totalW);
  // Thin history -> assume moderate uncertainty; clamp to a sensible range.
  const sigma = history.length < 4 ? 0.09 : Math.min(0.35, Math.max(0.04, resid));

  const cNow = curveAt(curve, daysNow);
  const forecast: ForecastPoint[] = [];
  for (let h = 1; h <= daysNow; h++) {
    const c = curveAt(curve, daysNow - h);
    // Start from today's price and revert toward the fitted level over a couple of weeks.
    const pull = 1 - Math.exp(-h / 10);
    const mid = price * (c / cNow) * ((level * cNow) / price) ** pull;
    const spread = Math.exp(1.28 * sigma * Math.sqrt(Math.min(h, 90) / 14));
    forecast.push({ date: addDays(today, h), price: Math.round(mid), low: Math.round(mid / spread), high: Math.round(mid * spread) });
  }

  let lowest = { date: today, price };
  for (const f of forecast) if (f.price < lowest.price) lowest = { date: f.date, price: f.price };

  const prices = history.map((p) => p.price).sort((a, b) => a - b);
  const average = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  const typicalRange: [number, number] =
    prices.length >= 4 ? [Math.round(quantile(prices, 0.2)), Math.round(quantile(prices, 0.8))] : [Math.round(price * 0.9), Math.round(price * 1.1)];
  const levelLabel: PriceLevel = price <= typicalRange[0] ? "low" : price >= typicalRange[1] ? "high" : "typical";

  const verdict: PriceVerdict =
    daysNow === 0 || lowest.price >= price * 0.97 ? "book" : lowest.price <= price * 0.92 ? "wait" : "steady";

  return {
    today,
    departDate,
    currentPrice: price,
    history,
    forecast,
    lowest,
    average,
    typicalRange,
    level: levelLabel,
    verdict,
    basis: {
      historyPoints: history.length,
      curveSeries: curve.series,
      curveObservations: curve.observations.reduce((s, n) => s + n, 0),
      simulated: !!input.simulated,
    },
  };
}
