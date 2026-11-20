import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
