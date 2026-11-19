import destinationList from "./data/destinations.json";

/**
 * "When to visit" guides: turn monthly climate normals and public holidays into a per-month
 * comfort score, a demand estimate, the best-value months and plain-English explanations.
 *
 * Every sentence is built from the numbers, so nothing is invented. There are no prices here:
 * guide pages are public, so a price section waits for real fare data rather than simulated prices.
 */

export interface Destination {
  slug: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  /** Place token the app searches for (an IATA code or a city: token). */
  searchTo: string;
  /** Shown when the search uses a nearby city's airports, e.g. Kyoto via Osaka. */
  via?: string;
  /** Famous seasonal peaks no holiday calendar knows about (curated by Farescope). */
  events?: SeasonalEvent[];
}

export interface SeasonalEvent {
  months: number[];
  name: string;
  /** When it usually happens, in words. */
  when: string;
  /** Extra demand it adds, 0..1. */
  weight: number;
}

export const DESTINATIONS: Destination[] = destinationList as Destination[];
export const DESTINATION_BY_SLUG: Record<string, Destination> = Object.fromEntries(DESTINATIONS.map((d) => [d.slug, d]));

/** Raw NASA POWER climatology, 12 monthly values per parameter (Jan..Dec). */
export interface ClimateRaw {
  period?: string | null;
  monthly: { T2M: (number | null)[]; T2M_RANGE: (number | null)[]; PRECTOTCORR: (number | null)[]; RH2M: (number | null)[] };
}

export interface Holiday {
  date: string;
  name: string;
}

export interface MonthClimate {
  month: number; // 1..12
  highC: number;
  lowC: number;
  rainMm: number;
  humidity: number;
}

export type MonthLabel = "Best value" | "Peak season" | "Shoulder season" | "Off-season";

export interface MonthGuide {
  month: number;
  climate: MonthClimate;
  /** 0..1: how pleasant the weather is for sightseeing. */
  comfort: number;
  /** 0..1: how busy and expensive travel usually is (holidays, US school breaks, peak weather). */
  demand: number;
  /** 0..1: comfort discounted by demand. */
  value: number;
  label: MonthLabel;
  holidays: Holiday[];
  usPeak?: string;
  events: SeasonalEvent[];
  winterSun: boolean;
  notes: string[];
}

export interface DestinationGuide {
  destination: Destination;
  months: MonthGuide[];
  /** Best-value months, best first (1..12). */
  best: number[];
  /** Busiest months, busiest first. */
  busiest: number[];
  summary: string;
  /** False when no holiday data exists for the country (we then don't claim there are none). */
  holidayData: boolean;
  climatePeriod?: string | null;
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const cToF = (c: number) => Math.round((c * 9) / 5 + 32);
export const mmToIn = (mm: number) => Math.round((mm / 25.4) * 10) / 10;
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Monthly highs/lows from POWER's mean temperature ± half the average daily range; rain in mm/month. */
export function monthlyClimate(raw: ClimateRaw): MonthClimate[] {
  const m = raw.monthly;
  return MONTH_NAMES.map((_, i) => {
    const mean = m.T2M[i] ?? NaN;
    const range = m.T2M_RANGE[i] ?? 0;
    return {
      month: i + 1,
      highC: round1(mean + range / 2),
      lowC: round1(mean - range / 2),
      rainMm: Math.round((m.PRECTOTCORR[i] ?? 0) * DAYS[i]),
      humidity: Math.round(m.RH2M[i] ?? 0),
    };
  });
}

/** Weather comfort for sightseeing: pleasant highs, little rain, not muggy. */
export function comfortScore(c: MonthClimate): number {
  const h = c.highC;
  const temp = h < 20 ? clamp((h - 4) / 16) : h <= 28 ? 1 : clamp((38 - h) / 10);
  const rain = c.rainMm <= 60 ? 0 : c.rainMm >= 260 ? 0.6 : ((c.rainMm - 60) / 200) * 0.6;
  const muggy = c.humidity >= 78 && h >= 27 ? 0.15 : 0;
  return round2(clamp(temp * (1 - rain) - muggy));
}
const round2 = (x: number) => Math.round(x * 100) / 100;

/** When flights from the US are usually busiest (school and holiday breaks). */
export function usPeak(month: number): { weight: number; label: string } | undefined {
  if (month === 6 || month === 7) return { weight: 0.35, label: "US summer break" };
  if (month === 8) return { weight: 0.25, label: "US summer break" };
  if (month === 12) return { weight: 0.3, label: "US Christmas and New Year holidays" };
  if (month === 3) return { weight: 0.15, label: "US spring break" };
  if (month === 11) return { weight: 0.1, label: "US Thanksgiving week" };
  return undefined;
}

/**
 * Northern-winter escapes: warm places near the tropics fill up from December to March as
 * travelers from colder countries head south.
 */
export function isWinterSun(d: Pick<Destination, "lat">, c: MonthClimate): boolean {
  return [12, 1, 2, 3].includes(c.month) && Math.abs(d.lat) < 32 && c.highC >= 24;
}

export function demandScore(
  month: number,
  comfort: number,
  holidays: Holiday[],
  extra: { events?: SeasonalEvent[]; winterSun?: boolean } = {},
): number {
  const peak = usPeak(month)?.weight ?? 0;
  const local = Math.min(0.3, holidays.length * 0.08);
  const events = Math.min(0.4, (extra.events ?? []).reduce((s, e) => s + e.weight, 0));
  const winter = extra.winterSun ? 0.2 : 0;
  // Good weather draws crowds too: peak season usually lines up with the nicest months.
  return round2(clamp(0.15 + peak + local + events + winter + 0.3 * comfort));
}

/**
 * Best value = pleasant and not too busy. Peak = busy and at least tolerable. Off-season = less
 * pleasant AND quiet; a hot or wet month that's still in demand is "shoulder", not "off".
 */
function labelFor(comfort: number, demand: number): MonthLabel {
  if (comfort >= 0.65 && demand < 0.62) return "Best value";
  if (demand >= 0.62 && comfort >= 0.4) return "Peak season";
  if (comfort < 0.4 && demand < 0.5) return "Off-season";
  return "Shoulder season";
}

const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export const tempText = (c: number) => `${cToF(c)}°F (${Math.round(c)}°C)`;
const rainText = (mm: number) => `${mm} mm (${mmToIn(mm)} in)`;

/** Sentences for one month, each built from that month's numbers. */
export function monthNotes(g: Omit<MonthGuide, "notes">, all: MonthClimate[], holidayData: boolean): string[] {
  const c = g.climate;
  const notes = [`Highs around ${tempText(c.highC)}, lows around ${tempText(c.lowC)}.`];
  const rains = [...all].map((x) => x.rainMm).sort((a, b) => b - a);
  if (c.rainMm >= 150 || c.rainMm >= rains[2]) {
    notes.push(`Wet: about ${rainText(c.rainMm)} of rain${c.rainMm === rains[0] ? ", the rainiest month" : ", one of the rainiest months"}.`);
  } else if (c.rainMm <= 40) {
    notes.push(`Dry: about ${rainText(c.rainMm)} of rain.`);
  }
  if (c.humidity >= 78 && c.highC >= 27) notes.push(`Humid, around ${c.humidity}% humidity.`);
  if (g.holidays.length) {
    notes.push(`Public holidays: ${listJoin(g.holidays.map((h) => `${h.name} (${shortDate(h.date)})`))}. Expect busier trains, hotels and sights.`);
  } else if (holidayData) {
    notes.push("No nationwide public holidays.");
  }
  for (const e of g.events) notes.push(`${e.name} (${e.when}) draws big crowds; book early and expect higher prices.`);
  if (g.winterSun) notes.push("Winter-sun season: travelers escaping colder weather keep demand and prices high.");
  if (g.usPeak) notes.push(`${g.usPeak}: flights from the US are usually busier and pricier.`);
  if (g.label === "Best value") notes.push("Good weather with lower demand, which usually means better prices.");
  if (g.label === "Off-season") {
    notes.push(
      g.usPeak || g.events.length || g.winterSun
        ? "The weather is less pleasant, but demand stays up, so don't expect off-season prices."
        : "Off-season weather keeps demand down, which usually means lower prices.",
    );
  }
  return notes;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

/** Month list as compact ranges: [9,10,11] → "Sep–Nov", [4,10] → "Apr and Oct". */
export function monthRanges(months: number[]): string {
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const m of sorted) {
    const last = runs.at(-1);
    if (last && m === last[last.length - 1] + 1) last.push(m);
    else runs.push([m]);
  }
  // Join a December run with a January run (Dec–Feb).
  if (runs.length > 1 && runs[0][0] === 1 && runs.at(-1)!.at(-1) === 12) {
    const head = runs.shift()!;
    runs.at(-1)!.push(...head);
  }
  return listJoin(runs.map((r) => (r.length === 1 ? MONTH_SHORT[r[0] - 1] : `${MONTH_SHORT[r[0] - 1]}–${MONTH_SHORT[r[r.length - 1] - 1]}`)));
}

export function buildGuide(destination: Destination, raw: ClimateRaw, holidays: Holiday[] | null): DestinationGuide {
  const climate = monthlyClimate(raw);
  const holidayData = holidays !== null && holidays.length > 0;
  const base = climate.map((c) => {
    const comfort = comfortScore(c);
    const monthHolidays = (holidays ?? []).filter((h) => Number(h.date.slice(5, 7)) === c.month);
    const events = (destination.events ?? []).filter((e) => e.months.includes(c.month));
    const winterSun = isWinterSun(destination, c);
    const demand = demandScore(c.month, comfort, monthHolidays, { events, winterSun });
    const value = round2(comfort * (1 - 0.5 * demand));
    return { month: c.month, climate: c, comfort, demand, value, label: labelFor(comfort, demand), holidays: monthHolidays, usPeak: usPeak(c.month)?.label, events, winterSun };
  });
  const months: MonthGuide[] = base.map((g) => ({ ...g, notes: monthNotes(g, climate, holidayData) }));

  // Best value = good weather without the crowds. Only if no month qualifies, fall back to the
  // most pleasant months overall.
  const byValue = [...months].sort((a, b) => b.value - a.value);
  const bestValue = byValue.filter((m) => m.label === "Best value");
  const best = (bestValue.length ? bestValue : byValue.filter((m) => m.comfort >= 0.5)).slice(0, 3).map((m) => m.month);
  // Peak season = pleasant AND in high demand; a busy month with bad weather isn't "peak".
  const busiest = [...months].filter((m) => m.label === "Peak season").sort((a, b) => b.demand - a.demand).slice(0, 3).map((m) => m.month);
  const summary = bestValue.length
    ? summarize(destination, months, best, busiest)
    : noValueSummary(destination, months, best);
  return { destination, months, best, busiest, summary, holidayData, climatePeriod: raw.period };
}

/** When no month pairs good weather with low demand, say so instead of calling a peak month "best value". */
function noValueSummary(d: Destination, months: MonthGuide[], pleasant: number[]): string {
  if (!pleasant.length) return summarize(d, months, pleasant, []);
  const highs = pleasant.map((m) => cToF(months[m - 1].climate.highC));
  const lo = Math.min(...highs), hi = Math.max(...highs);
  const busy = pleasant.some((m) => months[m - 1].label === "Peak season");
  return `Most pleasant: ${monthRanges(pleasant)}, with highs ${lo === hi ? `around ${lo}°F` : `of ${lo}–${hi}°F`}${busy ? ", but that's also peak season, so book early" : ""}. No month combines good weather with low demand.`;
}

function summarize(d: Destination, months: MonthGuide[], best: number[], busiest: number[]): string {
  if (!best.length) {
    const mild = [...months].sort((a, b) => b.comfort - a.comfort).slice(0, 2).map((m) => m.month);
    return `${d.name}'s weather is challenging most of the year; the mildest months are ${monthRanges(mild)}.`;
  }
  const b = best.map((m) => months[m - 1]);
  const highs = b.map((m) => cToF(m.climate.highC));
  const lo = Math.min(...highs), hi = Math.max(...highs);
  const reasons = [lo === hi ? `highs around ${lo}°F` : `highs of ${lo}–${hi}°F`];
  const avgRain = months.reduce((s, m) => s + m.climate.rainMm, 0) / 12;
  if (b.every((m) => m.climate.rainMm < avgRain)) reasons.push("less rain than average");
  const peakFree = busiest.filter((m) => !best.includes(m));
  if (b.every((m) => !m.usPeak)) reasons.push("outside US school and holiday breaks");
  const tail = peakFree.length ? `, so trips are usually cheaper than in ${monthRanges(peakFree)}` : "";
  return `Best value: ${monthRanges(best)}, with ${listJoin(reasons)}${tail}.`;
}
