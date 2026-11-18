import { daysBetween, type Fare } from "@farescope/shared";

export const SHORTLIST_LIMIT = 4;

/** Choose distinct lodging queries, keeping their cheapest flight and favoring varied trips. */
export function shortlistCandidates(fares: Fare[], start: string) {
  const unique = new Map<string, Fare>();
  for (const fare of fares) {
    const checkIn = fare.outbound.at(-1)?.arrive.slice(0, 10);
    if (!checkIn || !fare.returnDate || fare.returnDate <= checkIn) continue;
    const key = [fare.destination, checkIn, fare.returnDate].join("|");
    const current = unique.get(key);
    if (!current || fare.price < current.price) unique.set(key, fare);
  }
  const pool = [...unique.values()].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id)).map(fare => {
    const checkIn = fare.outbound.at(-1)!.arrive.slice(0, 10);
    const checkOut = fare.returnDate!;
    return { fare, checkIn, checkOut, nights: daysBetween(checkIn, checkOut), week: Math.floor(daysBetween(start, fare.departDate) / 7) };
  });
  const eligible = pool.length;
  const selected: typeof pool = [];
  while (pool.length && selected.length < SHORTLIST_LIMIT) {
    let bestIndex = 0;
    let bestScore = -1;
    for (const [i, candidate] of pool.entries()) {
      const score = Number(selected.every(x => x.fare.destination !== candidate.fare.destination)) +
        Number(selected.every(x => x.week !== candidate.week)) + Number(selected.every(x => x.nights !== candidate.nights));
      if (score > bestScore) { bestIndex = i; bestScore = score; }
    }
    selected.push(pool.splice(bestIndex, 1)[0]);
  }
  return { eligible, selected };
}
