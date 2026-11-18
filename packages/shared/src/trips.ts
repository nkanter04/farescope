import { daysBetween } from "./dates.ts";
import { AIRPORT_BY_IATA } from "./airports.ts";
import type { Fare, LodgingStop, TripPlan } from "./types.ts";

export function tripStops(trip: Pick<TripPlan, "lodging" | "stay" | "fare">): LodgingStop[] {
  if (trip.lodging) return trip.lodging;
  const stay = trip.stay;
  return stay ? [{ id: "legacy", place: AIRPORT_BY_IATA[trip.fare.destination]?.city ?? trip.fare.destination,
    checkIn: stay.checkIn, checkOut: stay.checkOut, stay }] : [];
}

export function lodgingCost(stop: LodgingStop): number | undefined {
  return stop.stay?.total ?? stop.ownCost;
}

export function tripTotal(trip: Pick<TripPlan, "fare" | "lodging" | "stay">): number {
  return trip.fare.price + tripStops(trip).reduce((sum, stop) => sum + (lodgingCost(stop) ?? 0), 0);
}

export function lodgingCoverage(fare: Fare, stops: LodgingStop[]) {
  const arrival = fare.outbound.at(-1)?.arrive.slice(0, 10) || fare.departDate;
  const sorted = [...stops].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  let end = arrival;
  let gaps = 0;
  let conflict = false;
  let nights = 0;
  for (const stop of sorted) {
    const length = daysBetween(stop.checkIn, stop.checkOut);
    if (!Number.isFinite(length) || length <= 0) { conflict = true; continue; }
    if (stop.checkIn < end || (fare.returnDate && stop.checkOut > fare.returnDate)) conflict = true;
    gaps += Math.max(0, daysBetween(end, stop.checkIn));
    nights += Math.max(0, length || 0);
    if (stop.checkOut > end) end = stop.checkOut;
  }
  if (fare.returnDate) gaps += Math.max(0, daysBetween(end, fare.returnDate));
  const unpriced = stops.filter(stop => lodgingCost(stop) === undefined).length;
  return { nights, gaps, conflict, unpriced, complete: !!fare.returnDate && !conflict && gaps === 0 && unpriced === 0 && stops.length > 0 };
}

export function comparableTrips(trips: TripPlan[]): boolean {
  const first = trips[0];
  const stayProviders = new Set(trips.flatMap(trip => tripStops(trip).flatMap(stop => stop.stay ? [stop.stay.provider] : [])));
  return trips.length >= 2 && first.adults !== undefined && stayProviders.size <= 1 && trips.every(trip =>
    trip.adults === first.adults && trip.fare.provider === first.fare.provider && !trip.fare.stale &&
    lodgingCoverage(trip.fare, tripStops(trip)).complete &&
    tripStops(trip).every(stop => !stop.stay || (!stop.stay.stale &&
      (stop.stay.provider === "mock" || stop.stay.totalBasis === "quoted"))));
}
