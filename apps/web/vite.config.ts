import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Travelpayouts Drive script for this build's project (it only runs on the project's registered
 * domain): 603815 = the GitHub Pages demo, 605452 = the live site (TP_PROJECT_ID in deploy.yml).
 * Keep in sync with driveSrc() in src/guides/pages.tsx.
 */
function travelpayoutsDrive(): Plugin {
  const raw = process.env.TP_PROJECT_ID ?? "";
  const project = /^\d{4,9}$/.test(raw) ? raw : "603815";
  const src = `https://emrldco.com/${Buffer.from(project).toString("base64")}.js?t=${project}`;
  return { name: "travelpayouts-drive", transformIndexHtml: (html) => html.replace("%TP_DRIVE_SRC%", src) };
}

export default defineConfig({
  plugins: [react(), travelpayoutsDrive()],
  // Relative asset paths so the demo build works under https://<user>.github.io/farescope/
  base: "./",
  // The app lives at /app/; the static homepage, guides and legal pages are written to dist/ by guides:build.
  build: { outDir: "dist/app", emptyOutDir: true },
  server: {
    port: 5180,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
  },
});
