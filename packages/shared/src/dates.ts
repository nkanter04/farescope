/** Date helpers that work on plain "YYYY-MM-DD" strings in UTC to avoid timezone drift. */

export function parseISODate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = parseISODate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toISODate(x);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}
