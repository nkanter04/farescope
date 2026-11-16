import { useMemo } from "react";
import type { Fare } from "@farescope/shared";
import { useStore } from "./store.ts";

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

  return useMemo(() => {
    const destBest = new Map<string, Fare>();
    const byDay = new Map<string, DayCell>();
    const byNights = new Map<number, number>();
    let min = Infinity;
    let max = 0;
    for (const f of fares) {
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
    const list = fares
      .filter((f) => (!filterDest || f.destination === filterDest) && (!filterDate || f.departDate === filterDate))
      .sort((a, b) => a.price - b.price)
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
      cheapest: list[0] as Fare | undefined,
    };
  }, [fares, filterDest, filterDate]);
}
