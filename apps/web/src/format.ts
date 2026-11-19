import { AIRPORT_BY_IATA, parseISODate, tripStops, type Fare, type Stay, type TripPlan } from "@farescope/shared";

export function tripPriceNote(trip: Pick<TripPlan, "fare" | "stay" | "lodging">): string {
  const stops = tripStops(trip);
  return [trip.fare.stale || stops.some(stop => stop.stay?.stale) ? "Includes older prices" : "",
    stops.some(stop => stop.stay?.totalBasis === "nightly-estimate") ? "Includes estimated accommodation" : ""].filter(Boolean).join(" · ");
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const money = (n: number) => usd.format(n);
export const travelerCount = (adults?: number) =>
  adults === undefined ? "Traveler count unknown" : `${adults} ${adults === 1 ? "adult" : "adults"}`;

export const priceScope = (stay?: Stay | null) => {
  if (!stay) return "Flight only";
  if (stay.stale) return stay.totalBasis === "nightly-estimate" ? "Flight + older stay estimate" : "Flight + older stay price";
  if (stay.totalBasis === "nightly-estimate") return "Flight + estimated stay";
  return "Flight + stay";
};

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

/** "NRT/HND/KIX +2": the airports a fare covers (several for a date-grid price). */
export function airportCodes(codes: string[], max = 3): string {
  return codes.length <= max ? codes.join("/") : `${codes.slice(0, max).join("/")} +${codes.length - max}`;
}

/** "Tokyo, Osaka +1": the cities a fare covers. */
export function cityList(codes: string[], max = 2): string {
  const cities = [...new Set(codes.map(cityOf))];
  return cities.length <= max ? cities.join(", ") : `${cities.slice(0, max).join(", ")} +${cities.length - max}`;
}

/** Route ends for a fare: a whole place's name ("Japan") for calendar prices, else airport codes. */
export function fareEnds(f: Fare): { from: string; to: string; toCity: string; fromCity: string } {
  const c = f.coverage;
  const side = (label: string | undefined, ids: string[] | undefined, airport: string) =>
    label ?? (ids && ids.every((id) => /^[A-Z]{3}$/.test(id)) ? airportCodes(ids) : airport);
  return {
    from: side(c?.originLabel, c?.origins, f.origin),
    to: side(c?.destinationLabel, c?.destinations, f.destination),
    fromCity: c?.originLabel ? `Anywhere in ${c.originLabel}` : cityOf(f.origin),
    toCity: c?.destinationLabel ? `Anywhere in ${c.destinationLabel}` : cityOf(f.destination),
  };
}
