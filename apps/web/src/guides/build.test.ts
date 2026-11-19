import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DESTINATIONS } from "@farescope/shared";
import { buildAll, MONTH_INDEX_PATH, monthIndexJson } from "./build.tsx";

const out = mkdtempSync(join(tmpdir(), "guides-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));
const site = { siteUrl: "https://example.test/fs", today: "2026-11-19" };
const paths = buildAll(site, out);
const page = (p: string) => readFileSync(join(out, p), "utf8");

describe("static guide pages", () => {
  it("writes an index, one page per destination, 12 month pages and a sitemap", () => {
    expect(paths).toHaveLength(2 + DESTINATIONS.length + 12 + 2); // + privacy and terms
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
    expect(html).toContain("Tripica is operated by Kanter Capital LLC");
    expect(html).toContain('href="../../favicon.svg"');
    expect(html).toContain('class="brand-mark"');
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

  it("links to plain searches without partners, and to partners with a disclosure once configured", () => {
    const plain = page("guides/kyoto/index.html");
    expect(plain).toContain("Plan the rest of your Kyoto trip");
    expect(plain).toContain("https://www.google.com/search?q=things%20to%20do%20in%20Kyoto%2C%20Japan");
    expect(plain).not.toContain("may earn a commission");

    const out2 = mkdtempSync(join(tmpdir(), "guides-aff-"));
    try {
      buildAll({ ...site, partners: [{ partner: "GetYourGuide", kind: "activity", url: "https://www.getyourguide.com/s/?q={city}&partner_id=TEST" }] }, out2);
      const html = readFileSync(join(out2, "guides/kyoto/index.html"), "utf8");
      expect(html).toContain("https://www.getyourguide.com/s/?q=Kyoto&amp;partner_id=TEST");
      expect(html).toContain('rel="noreferrer sponsored"');
      expect(html).toContain("Tripica may earn a commission");
    } finally {
      rmSync(out2, { recursive: true, force: true });
    }
  });

  it("says so when a country has no holiday data instead of claiming there are none", () => {
    const html = page("guides/bangkok/index.html");
    expect(html).toContain("Public-holiday data for Thailand isn");
    expect(html).not.toContain("No nationwide public holidays");
  });

  it("keeps the app's month-label index in sync with the guides (run npm run guides:build)", () => {
    expect(readFileSync(MONTH_INDEX_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(monthIndexJson());
  });

  it("loads the Travelpayouts Drive script on guide pages", () => {
    expect(page("guides/index.html")).toContain('src="https://emrldco.com/NjAzODE1.js?t=603815"');
  });

  it("renders styled privacy and terms pages that state retention, with a contact only when configured", () => {
    const privacy = page("privacy/index.html");
    expect(privacy).toContain("guides.css");
    expect(privacy).toContain("deleted after 31 days");
    expect(privacy).toContain("Turnstile Privacy Addendum");
    expect(privacy).not.toContain("NASA POWER"); // data credits only on guide pages
    expect(page("terms/index.html")).toContain("Terms of use");
    expect(readFileSync(join(out, "sitemap.xml"), "utf8")).toContain("/privacy/");
    const withContact = mkdtempSync(join(tmpdir(), "guides-contact-"));
    try {
      buildAll({ siteUrl: "https://example.test", today: "2026-11-19", contactEmail: "hello@example.test" }, withContact);
      expect(readFileSync(join(withContact, "privacy/index.html"), "utf8")).toContain("mailto:hello@example.test");
    } finally {
      rmSync(withContact, { recursive: true, force: true });
    }
  });
});
