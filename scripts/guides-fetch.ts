/**
 * Fetch the raw data behind the destination guides and cache it in data/guides/raw/ (committed),
 * so builds and CI never need the network.
 *
 *   npm run guides:fetch            # fetch anything missing
 *   npm run guides:fetch -- --force # refetch everything
 *
 * Sources (both free for commercial use; credit shown on every guide page):
 * - NASA POWER climatology API: monthly climate normals per lat/lng.
 *   https://power.larc.nasa.gov/docs/services/api/temporal/climatology/
 * - Nager.Date: public holidays per country and year. https://date.nager.at
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const rawDir = `${root}data/guides/raw`;
const destinations = JSON.parse(readFileSync(`${root}packages/shared/src/data/destinations.json`, "utf8")) as {
  slug: string; country: string; lat: number; lng: number;
}[];
const force = process.argv.includes("--force");
const YEARS = [2027, 2028];
const PARAMS = ["T2M", "T2M_RANGE", "PRECTOTCORR", "RH2M"];

mkdirSync(`${rawDir}/climate`, { recursive: true });
mkdirSync(`${rawDir}/holidays`, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "farescope-guides/1.0" }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 204 || res.status === 404) return null;
      if (res.ok) return await res.json();
      if (attempt === 5) throw new Error(`${res.status} for ${url}`);
    } catch (e) {
      // Network hiccups (resets, timeouts) are retried; give up after the last attempt.
      if (attempt === 5) throw e;
    }
    await sleep(2000 * attempt);
  }
  return null;
}

let climateFetched = 0;
for (const d of destinations) {
  const file = `${rawDir}/climate/${d.slug}.json`;
  if (!force && existsSync(file)) continue;
  const url =
    `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=${PARAMS.join(",")}` +
    `&community=RE&longitude=${d.lng}&latitude=${d.lat}&format=JSON`;
  const json = (await getJson(url)) as { properties?: { parameter?: Record<string, Record<string, number>> }; header?: { range?: string } } | null;
  const parameter = json?.properties?.parameter;
  if (!parameter) throw new Error(`No climate data for ${d.slug}`);
  // Keep only what the guides use: 12 monthly values per parameter, plus provenance.
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const trimmed = Object.fromEntries(PARAMS.map((p) => [p, months.map((m) => parameter[p]?.[m] ?? null)]));
  writeFileSync(
    file,
    JSON.stringify({ slug: d.slug, lat: d.lat, lng: d.lng, source: "NASA POWER climatology (community RE)", period: json?.header?.range ?? null, fetched: new Date().toISOString().slice(0, 10), monthly: trimmed }, null, 1) + "\n",
  );
  climateFetched++;
  console.log(`climate  ${d.slug}`);
  await sleep(400);
}

let holidaysFetched = 0;
const countries = [...new Set([...destinations.map((d) => d.country), "US"])].sort();
for (const cc of countries) {
  const file = `${rawDir}/holidays/${cc}.json`;
  if (!force && existsSync(file)) continue;
  const years: Record<string, { date: string; name: string; global: boolean }[]> = {};
  for (const y of YEARS) {
    const list = (await getJson(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`)) as
      | { date: string; name: string; global: boolean; types?: string[] }[]
      | null;
    // Nationwide public holidays only; regional ones would overstate crowds.
    years[y] = (list ?? []).filter((h) => h.global && (h.types ?? ["Public"]).includes("Public")).map((h) => ({ date: h.date, name: h.name, global: h.global }));
    await sleep(250);
  }
  writeFileSync(file, JSON.stringify({ country: cc, source: "Nager.Date", fetched: new Date().toISOString().slice(0, 10), years }, null, 1) + "\n");
  holidaysFetched++;
  console.log(`holidays ${cc} (${Object.values(years).map((l) => l.length).join("/")})`);
}

console.log(`Done: ${climateFetched} climate files, ${holidaysFetched} holiday files fetched (cached ones skipped).`);
