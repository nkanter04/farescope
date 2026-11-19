/** @jsxRuntime automatic */
/** @jsxImportSource react */
/// <reference types="node" />
/**
 * Render the "When to visit" guides to static HTML in apps/web/dist/guides/ (run after the Vite
 * build). Reads the cached data in data/guides/raw/, so it needs no network.
 *
 *   npm run guides:build                       # SITE_URL defaults to the GitHub Pages URL
 *   SITE_URL=https://tripica.example npm run guides:build
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildGuide, DESTINATIONS, guideMonthIndex, parsePartnerTemplates, todayISO, type ClimateRaw, type DestinationGuide, type Holiday } from "@farescope/shared";
import { DestinationPage, IndexPage, MonthPage, monthSlug, type SiteConfig } from "./pages.tsx";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const raw = `${root}data/guides/raw`;
const out = process.env.GUIDES_OUT ?? `${root}apps/web/dist`;
const HOLIDAY_YEAR = "2027";

export function loadGuides(): DestinationGuide[] {
  return DESTINATIONS.map((d) => {
    const climate = JSON.parse(readFileSync(`${raw}/climate/${d.slug}.json`, "utf8")) as ClimateRaw;
    const holidayFile = `${raw}/holidays/${d.country}.json`;
    const holidays = existsSync(holidayFile)
      ? ((JSON.parse(readFileSync(holidayFile, "utf8")) as { years: Record<string, Holiday[]> }).years[HOLIDAY_YEAR] ?? null)
      : null;
    return buildGuide(d, climate, holidays && holidays.length ? holidays : null);
  });
}

/** The app's explore page reads month labels from this committed file (a test keeps it current). */
export const MONTH_INDEX_PATH = fileURLToPath(new URL("../explore/month-index.json", import.meta.url));
export const monthIndexJson = (guides = loadGuides()) =>
  `{\n${Object.entries(guideMonthIndex(guides)).map(([slug, v]) => `  ${JSON.stringify(slug)}: ${JSON.stringify(v)}`).join(",\n")}\n}
`;

export function renderPage(element: ReactElement): string {
  return `<!doctype html>${renderToStaticMarkup(element)}`;
}

function write(path: string, html: string) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, html);
}

export function buildAll(siteIn: SiteConfig, outDir = out): string[] {
  const cssPath = fileURLToPath(new URL("./guides.css", import.meta.url));
  const site = {
    ...siteIn,
    cssVersion: createHash("sha1").update(readFileSync(cssPath)).digest("hex").slice(0, 8),
    partners: siteIn.partners ?? parsePartnerTemplates(process.env.VITE_PARTNER_LINKS).templates,
  };
  const guides = loadGuides();
  const paths: string[] = ["", "guides/"];
  write(`${outDir}/guides/index.html`, renderPage(<IndexPage guides={guides} site={site} />));
  for (const g of guides) {
    write(`${outDir}/guides/${g.destination.slug}/index.html`, renderPage(<DestinationPage guide={g} site={site} />));
    paths.push(`guides/${g.destination.slug}/`);
  }
  for (let m = 1; m <= 12; m++) {
    write(`${outDir}/guides/month/${monthSlug(m)}/index.html`, renderPage(<MonthPage month={m} guides={guides} site={site} />));
    paths.push(`guides/month/${monthSlug(m)}/`);
  }
  mkdirSync(`${outDir}/guides`, { recursive: true });
  copyFileSync(cssPath, `${outDir}/guides/guides.css`);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${site.siteUrl}/${p}</loc><lastmod>${site.today}</lastmod></url>`).join("\n") +
    `\n</urlset>\n`;
  writeFileSync(`${outDir}/sitemap.xml`, sitemap);
  writeFileSync(`${outDir}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${site.siteUrl}/sitemap.xml\n`);
  return paths;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const siteUrl = (process.env.SITE_URL ?? "https://nkanter04.github.io/farescope").replace(/\/$/, "");
  const paths = buildAll({ siteUrl, today: todayISO() });
  writeFileSync(MONTH_INDEX_PATH, monthIndexJson());
  console.log(`Wrote ${paths.length - 1} guide pages, sitemap.xml and robots.txt to ${out} (site ${siteUrl}).`);
}
