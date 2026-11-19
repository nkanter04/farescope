# Tripica

*Formerly "Farescope". The repository, package names (`@farescope/*`) and the demo URL still use the old name until the move to a custom domain.*

### ▶ [Try the live demo](https://nkanter04.github.io/farescope/)

Search whole regions and date windows at once ("Austin → anywhere in Japan, leaving any day Jan–Apr, 7–12 nights") to compare flights. Results stream into a list, price calendar, and 3D globe. Sort by price, outbound duration, or stops, then save flights to My trips. Pick a flight to plan stays separately, one stop or several.

The demo uses simulated prices and runs entirely in your browser. Saved trips stay in that browser. Real prices come from the API server described below.

## Plan a flexible itinerary

- Open a result or edit a saved trip. Add stays in any city, neighborhood, or address, with separate check-in and check-out dates. The flight destination does not restrict lodging searches.
- Split a week between Tokyo and Kyoto, record accommodation already arranged (including free stays), or save a partial plan. Missing nights, overlapping dates, and unpriced stops are flagged; totals include only known airfare and accommodation costs.
- Review the dated route and open each transfer in Google Maps. Transport costs are not included. Connecting flight schedules and prices in the demo are simulated using historical route data; see [DATA_SOURCES.md](DATA_SOURCES.md).
- Name trips, add notes, reopen the original search, and compare up to three plans. A lowest-total label requires complete lodging coverage and comparable traveler counts and price sources.
- Share a read-only snapshot of one trip or a comparison. The compressed link includes notes and saved prices; anyone with the link can read it. Edits require a new link. Links generated on localhost only work on that computer; use the published website for sharing with others. Links do not create shared accounts or collaborative editing.

Existing single-hotel saves remain readable and can be edited into multiple stays. One-way trips can have dated stays but remain labeled as partial plans because there is no return date defining the end of the trip.

## Run it locally

```bash
npm install
npm run dev:api   # http://127.0.0.1:8787  (mock prices by default)
npm run dev:web   # http://localhost:5180  (proxies /api to the API)
npm test          # vitest: planner, cache, quota, providers, API routes
npm run typecheck
npm run build:demo -w @farescope/web   # the static demo that GitHub Pages serves
```

## Real prices (SerpApi)

1. Create a free account at serpapi.com. The free tier allows about 100–250 searches a month.
2. Copy `.env.example` to `apps/api/.env`, then set `PROVIDER=serpapi` and `SERPAPI_KEY=...`.
3. Keep `MONTHLY_QUERY_BUDGET` at or below your plan. `PER_SEARCH_BUDGET` caps how many real calls one flexible search may spend. The rest of the calendar comes from the cache or isn't sampled.

Every real result is cached (6–48 h depending on how far out the date is) and written to `price_history`. When the budget runs out, the app serves expired cached prices marked as stale instead of failing.

## Layout

| Path | What |
|---|---|
| `packages/shared` | Types, zod request schema, airports/countries/regions, place resolver and autocomplete |
| `apps/api/src/providers` | `mock`, `serpapi-flights`, `serpapi-hotels`, all behind one interface |
| `apps/api/src/search/planner.ts` | Expands a flexible search into provider calls; even sampling and refinement around the cheapest results |
| `apps/api/src/search/run.ts` | Runs the cache-first, budgeted search and streams it as server-sent events |
| `apps/api/src/{cache,quota,trips,db}.ts` | SQLite (Node's built-in `node:sqlite`) cache, price history, spend guard, saved trips |
| `apps/web` | React + Zustand UI: search form, globe (react-globe.gl), calendar, stays, trip planner |

## Not done yet (see plan)

- Supabase accounts. Trips are currently keyed to an anonymous per-browser id.
- Hosted Postgres; deployment (Vercel/Cloudflare + Render/Fly).
- Price alerts.
- The SerpApi fixtures in `apps/api/src/fixtures` are hand-built from SerpApi's documented response shape. Replace them with recorded responses once a key exists.
- Real-time route and schedule coverage, return-leg details, and multi-city/open-jaw flights. Airport search currently covers 4,007 airports; airport coverage does not guarantee an available flight.
