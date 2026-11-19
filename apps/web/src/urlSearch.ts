import { addDays, DESTINATIONS, resolvePlace, type SearchRequest } from "@farescope/shared";

/**
 * Deep links from the guides (and anywhere else) into a search:
 *   ?to=city:Osaka|JP&from=AUS&depart=2027-04
 * `depart` is a month (YYYY-MM) or a day (YYYY-MM-DD). Unknown places or bad dates are ignored.
 */
export function readUrlSearch(search: string, today: string): Partial<SearchRequest> | undefined {
  const q = new URLSearchParams(search);
  const to = q.get("to");
  if (!to || !resolvePlace(to)) return undefined;
  const patch: Partial<SearchRequest> = { destinations: [to] };
  const from = q.get("from");
  if (from && resolvePlace(from)) patch.origins = [from];
  const depart = q.get("depart") ?? "";
  const month = depart.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  const day = depart.match(/^\d{4}-\d{2}-\d{2}$/);
  if (month) {
    const first = `${month[1]}-${month[2]}-01`;
    const last = addDays(`${Number(month[2]) === 12 ? Number(month[1]) + 1 : month[1]}-${String((Number(month[2]) % 12) + 1).padStart(2, "0")}-01`, -1);
    if (last >= today) Object.assign(patch, { departFrom: first < today ? today : first, departTo: last });
  } else if (day && depart >= today) {
    Object.assign(patch, { departFrom: depart, departTo: depart });
  }
  return patch;
}

/** The guide for a destination airport, if we have one (e.g. KIX → the Kyoto and Osaka guides' first match). */
export function guideForAirport(iata: string): { slug: string; name: string } | undefined {
  return DESTINATIONS.find((d) => resolvePlace(d.searchTo)?.airports.includes(iata) && d.searchTo !== "city:Osaka|JP")
    ?? DESTINATIONS.find((d) => resolvePlace(d.searchTo)?.airports.includes(iata));
}
