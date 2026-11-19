import type { StayProvider } from "./types.ts";

/** Used when real flight data is on but no lodging source is configured: no prices, never fake ones. */
export function createNoStayProvider(): StayProvider {
  return { name: "none", live: false, callsPerSearch: 0, search: async () => [] };
}
