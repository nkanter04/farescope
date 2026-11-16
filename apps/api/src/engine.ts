/**
 * Browser-safe entry point: the search engine and mock providers with no Node-only imports.
 * Used by the static GitHub Pages demo, which runs the whole "backend" in the browser.
 */
export { runSearch, type RunDeps, type SearchCache, type SearchQuota } from "./search/run.ts";
export { createMockFlightProvider, createMockStayProvider } from "./providers/mock.ts";
export { ttlFor } from "./ttl.ts";
