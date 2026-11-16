import { AIRPORT_BY_IATA, parseISODate } from "@farescope/shared";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const money = (n: number) => usd.format(n);

export const duration = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export const shortDate = (d: string) =>
  parseISODate(d).toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });

export const cityOf = (iata: string) => AIRPORT_BY_IATA[iata]?.city ?? iata;

export const stopsLabel = (n: number) => (n === 0 ? "Nonstop" : n === 1 ? "1 stop" : `${n} stops`);

/** 0 = cheapest (green) .. 1 = priciest (red). */
export function priceColor(t: number, alpha = 1): string {
  const x = Math.min(1, Math.max(0, t));
  const hue = 145 - x * 140;
  return `hsla(${hue}, 75%, ${55 - x * 5}%, ${alpha})`;
}

export function relativeAge(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
