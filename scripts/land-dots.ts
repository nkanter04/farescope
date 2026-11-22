/**
 * Generates the homepage globe's land dots: an even grid of points on land, from Natural Earth's
 * 1:110m land polygons (public domain, via the world-atlas package). Output is committed, so builds
 * need no network or geo libraries at runtime.
 *
 *   npx tsx scripts/land-dots.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve("world-atlas/land-110m.json"), "utf8"));
const land = feature(topo, topo.objects.land) as unknown as Parameters<typeof geoContains>[0];

/** Degrees between rows; columns widen toward the poles so dots stay evenly spaced on the sphere. */
const STEP = 2.2;
const dots: number[] = [];
for (let lat = -56; lat <= 78; lat += STEP) {
  const step = STEP / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  const offset = (Math.round(lat / STEP) % 2) * (step / 2); // stagger rows
  for (let lon = -180 + offset; lon < 180; lon += step) {
    if (geoContains(land, [lon, lat])) dots.push(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10);
  }
}
const outPath = new URL("../apps/web/src/guides/land-dots.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(dots));
console.log(`${dots.length / 2} land dots → ${outPath.pathname}`);
