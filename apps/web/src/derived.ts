import { useMemo } from "react";
import { fareMatchesAirlines, type Fare } from "@farescope/shared";
import { ANY_AIRLINE, useStore } from "./store.ts";

/** Date-grid prices were filtered by the provider and list no airlines, so they always pass. */
export const passesAirlines = (f: Fare, airlines: readonly string[]) => !!f.priceOnly || fareMatchesAirlines(f, airlines);

/** Whether a fare's flight times and stops are known (date-grid prices list none until opened). */
const hasFlightDetails = (f: Fare) => !f.priceOnly && f.outbound.length > 0;

/**
 * Result order. "duration" and "stops" sort by the outbound flight; fares without flight details
 * (date-grid prices) go after those with them, since their 0 minutes and 0 stops mean "unknown".
 * Price breaks ties.
 */
export function compareFares(sort: "price" | "duration" | "stops") {
  return (a: Fare, b: Fare): number => {
    if (sort !== "price") {
      const known = Number(hasFlightDetails(b)) - Number(hasFlightDetails(a));
      if (known) return known;
      if (hasFlightDetails(a)) {
        const d = sort === "duration" ? a.durationMin - b.durationMin : a.stops - b.stops;
        if (d) return d;
      }
    }
    return a.price - b.price;
  };
}

export interface DayCell {
  date: string;
  price: number;
  nights: number | null;
  fare: Fare;
}

/** Aggregations over the streamed fares that the globe, calendar and list all share. */
export function useDerived() {
  const fares = useStore((s) => s.fares);
  const filterDest = useStore((s) => s.filterDest);
  const filterDate = useStore((s) => s.filterDate);
  const sort = useStore((s) => s.sort);
  const airlines = useStore((s) => s.request.airlines ?? ANY_AIRLINE);

  return useMemo(() => {
    // Globe, calendar and list all respect the airline filter.
    const shown = airlines.length ? fares.filter((f) => passesAirlines(f, airlines)) : fares;
    const destBest = new Map<string, Fare>();
    const byDay = new Map<string, DayCell>();
    const byNights = new Map<number, number>();
    let min = Infinity;
    let max = 0;
    for (const f of shown) {
      const nights = f.returnDate ? Math.round((Date.parse(f.returnDate) - Date.parse(f.departDate)) / 86_400_000) : null;
      if (!filterDest || f.destination === filterDest) {
        const cur = byDay.get(f.departDate);
        if (!cur || f.price < cur.price) byDay.set(f.departDate, { date: f.departDate, price: f.price, nights, fare: f });
        if (nights !== null) byNights.set(nights, Math.min(byNights.get(nights) ?? Infinity, f.price));
      }
      const d = destBest.get(f.destination);
      if (!d || f.price < d.price) destBest.set(f.destination, f);
      min = Math.min(min, f.price);
      max = Math.max(max, f.price);
    }
    const dayPrices = [...byDay.values()].map((c) => c.price);
    const dayMin = Math.min(...dayPrices);
    const dayMax = Math.max(...dayPrices);

    const seen = new Set<string>();
    const list = shown
      .filter((f) => (!filterDest || f.destination === filterDest) && (!filterDate || f.departDate === filterDate))
      .sort(compareFares(sort))
      .filter((f) => {
        // collapse identical itineraries seen through overlapping queries
        const k = `${f.origin}${f.destination}${f.departDate}${f.returnDate}${f.price}${f.airlines.join()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 60);

    const destPrices = [...destBest.values()].map((f) => f.price);
    return {
      destBest,
      byDay,
      byNights,
      list,
      min,
      max,
      dayMin,
      dayMax,
      destMin: Math.min(...destPrices),
      destMax: Math.max(...destPrices),
      cheapest: list.reduce<Fare | undefined>((best, fare) => !best || fare.price < best.price ? fare : best, undefined),
    };
  }, [fares, filterDest, filterDate, sort, airlines]);
}
