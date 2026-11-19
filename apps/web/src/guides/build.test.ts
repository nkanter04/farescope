import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DESTINATIONS } from "@farescope/shared";
import { buildAll } from "./build.tsx";

const out = mkdtempSync(join(tmpdir(), "guides-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));
const site = { siteUrl: "https://example.test/fs", today: "2026-11-19" };
const paths = buildAll(site, out);
const page = (p: string) => readFileSync(join(out, p), "utf8");

describe("static guide pages", () => {
  it("writes an index, one page per destination, 12 month pages and a sitemap", () => {
    expect(paths).toHaveLength(2 + DESTINATIONS.length + 12);
    const sitemap = page("sitemap.xml");
    expect(sitemap.match(/<url>/g)).toHaveLength(paths.length);
    expect(sitemap).toContain("<loc>https://example.test/fs/guides/kyoto/</loc>");
    expect(page("robots.txt")).toContain("Sitemap: https://example.test/fs/sitemap.xml");
  });

  it("renders a crawlable destination page with SEO tags, data credits and deep links", () => {
    const html = page("guides/kyoto/index.html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Best time to visit Kyoto: weather, crowds and cheaper months</title>");
    expect(html).toContain('<link rel="canonical" href="https://example.test/fs/guides/kyoto/"/>');
    expect(html).toContain('"@type":"TouristDestination"');
    expect(html.match(/<tr id="/g)).toHaveLength(12);
    expect(html).toContain("NASA POWER");
    expect(html).toContain("Nager.Date");
    expect(html).toContain("Farescope is operated by Kanter Capital LLC");
    // CTA into the app: relative to the site root, pre-filled with the airports and a month.
    expect(html).toMatch(/href="\.\.\/\.\.\/\?to=city%3AOsaka%7CJP&amp;depart=20\d\d-\d\d"/);
    expect(html).toContain("Cherry blossom season");
    expect(html).not.toMatch(/\$\d/); // no prices on public guide pages
  });

  it("ranks destinations on month pages and links back to the destination's month", () => {
    const html = page("guides/month/october/index.html");
    expect(html).toContain("<h1>Where to go in October</h1>");
    expect(html).toContain('href="../../../guides/kyoto/#october"');
  });

  it("says so when a country has no holiday data instead of claiming there are none", () => {
    const html = page("guides/bangkok/index.html");
    expect(html).toContain("Public-holiday data for Thailand isn");
    expect(html).not.toContain("No nationwide public holidays");
  });
});
