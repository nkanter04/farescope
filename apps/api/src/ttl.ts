import { daysBetween, toISODate } from "@farescope/shared";

const HOUR = 3_600_000;

/** Fares close to departure move fast; far-out fares are stable, so cache them longer. */
export function ttlFor(departDate: string, now: Date): number {
  const days = daysBetween(toISODate(now), departDate);
  if (days < 30) return 6 * HOUR;
  if (days < 90) return 24 * HOUR;
  return 48 * HOUR;
}
