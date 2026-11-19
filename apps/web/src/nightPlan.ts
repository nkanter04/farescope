import { addDays, daysBetween, type LodgingStop } from "@farescope/shared";

export interface NightRow {
  id: string;
  place: string;
  nights: string;
}

export function previewNightPlan(start: string, rows: NightRow[], existing: LodgingStop[]) {
  let date = start;
  return rows.map(row => {
    const nights = Number(row.nights);
    const checkIn = date;
    // Once a duration is missing, downstream dates are unknown too.
    date = checkIn && Number.isInteger(nights) && nights > 0 && nights <= 365
      ? addDays(checkIn, nights) : "";
    const original = existing.find(stop => stop.id === row.id);
    const place = row.place.trim();
    if (original && original.place.trim() === place && original.checkIn === checkIn && original.checkOut === date) return original;
    return { id: row.id, place, checkIn, checkOut: date } satisfies LodgingStop;
  });
}

export function initialNightRows(stops: LodgingStop[]): NightRow[] {
  return [...stops].sort((a, b) => a.checkIn.localeCompare(b.checkIn)).map(stop => {
    const nights = daysBetween(stop.checkIn, stop.checkOut);
    return { id: stop.id, place: stop.place, nights: nights > 0 ? String(nights) : "" };
  });
}
