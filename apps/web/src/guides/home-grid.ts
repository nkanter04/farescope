import type { HomeScene } from "./home-scenes.ts";

// Tiny UTC date helpers, so the browser bundle doesn't pull in the shared package's place data.
const parseISODate = (d: string) => new Date(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(parseISODate(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);

/**
 * The homepage's "every date × every trip length" grid: month blocks of departure days (columns) by
 * trip lengths (rows). Cell shades are a deterministic illustration (cheaper = greener), not prices.
 * Pure, shared by the static render and the browser animation.
 */
export interface GridMonth { label: string; start: string; days: number; offset: number }
export interface GridCell { day: number; nights: number; level: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function gridMonths(scene: Pick<HomeScene, "from" | "to">): GridMonth[] {
  const out: GridMonth[] = [];
  let start = scene.from;
  while (start <= scene.to) {
    const d = parseISODate(start);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    const end = next > scene.to ? addDays(scene.to, 1) : next;
    out.push({ label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, start, days: daysBetween(start, end), offset: daysBetween(scene.from, start) });
    start = next;
  }
  return out;
}

/** 0 (cheapest) .. 1 (priciest): smooth seasonal waves, a weekend bump and a little hashed noise. */
export function cellLevel(seed: number, day: number, nightsIndex: number, weekday: number): number {
  const hash = Math.sin((day + 1) * 12.9898 + (nightsIndex + 1) * 78.233 + seed * 37.719) * 43758.5453;
  const noise = hash - Math.floor(hash);
  const v = 0.5
    + 0.24 * Math.sin(day / 8.5 + seed * 1.7)
    + 0.12 * Math.sin(day / 2.9 + nightsIndex * 0.8 + seed)
    + (weekday === 5 || weekday === 6 ? 0.12 : weekday === 2 || weekday === 3 ? -0.06 : 0)
    + 0.06 * (nightsIndex % 3 === 0 ? 1 : -0.5)
    + 0.14 * (noise - 0.5);
  return Math.min(1, Math.max(0, v));
}

export function gridCells(scene: HomeScene, seed: number): GridCell[] {
  const days = daysBetween(scene.from, scene.to) + 1;
  const firstWeekday = parseISODate(scene.from).getUTCDay();
  const cells: GridCell[] = [];
  for (let n = scene.minNights; n <= scene.maxNights; n++) {
    for (let d = 0; d < days; d++) cells.push({ day: d, nights: n, level: cellLevel(seed, d, n - scene.minNights, (firstWeekday + d) % 7) });
  }
  return cells;
}

export function cheapestCell(cells: GridCell[]): GridCell {
  return cells.reduce((best, c) => (c.level < best.level ? c : best));
}

/** Shade bucket 0..4 for a level. */
export const shade = (level: number) => Math.min(4, Math.floor(level * 5));

export function cellLabel(scene: Pick<HomeScene, "from">, cell: GridCell): string {
  const date = parseISODate(addDays(scene.from, cell.day)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${date} · ${cell.nights} nights`;
}
