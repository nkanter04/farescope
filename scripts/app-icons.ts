/**
 * Renders the installable-app icons from the logo artwork into apps/web/public/icons/ (committed).
 * Re-run after changing the logo:   npx tsx scripts/app-icons.ts
 *
 * - icon-192/512.png: the rounded logo as-is ("any" purpose).
 * - icon-maskable-512.png: full-bleed blue with the sun kept inside the 80% safe zone, so Android
 *   can crop it to any shape.
 * - apple-touch-icon.png (180): full-bleed square; iOS rounds the corners itself and ignores SVG.
 */
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

const out = new URL("../apps/web/public/icons/", import.meta.url);
mkdirSync(out, { recursive: true });
const logo = readFileSync(new URL("../apps/web/public/logo.svg", import.meta.url), "utf8");

// The logo's drawing without its rounded background, for the full-bleed variants.
const glyph = logo.replace(/<title>.*?<\/title>/s, "").replace(/<rect[^>]*\/>/, "").replace(/<svg[^>]*>|<\/svg>/g, "");
const fullBleed = (scale: number) => {
  const offset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1570E8"/>` +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">${glyph}</g></svg>`;
};

const render = (svg: string, size: number, file: string) =>
  sharp(Buffer.from(svg), { density: 72 * (size / 64) * 2 }).resize(size, size).png({ compressionLevel: 9 }).toFile(new URL(file, out).pathname.replace(/^\/(\w:)/, "$1"));

await Promise.all([
  render(logo, 192, "icon-192.png"),
  render(logo, 512, "icon-512.png"),
  render(fullBleed(0.72), 512, "icon-maskable-512.png"),
  render(fullBleed(0.86), 180, "apple-touch-icon.png"),
]);
console.log("Wrote app icons to apps/web/public/icons/");
