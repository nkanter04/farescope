# Farescope (working name)

### ▶ [Try the live demo](https://nkanter04.github.io/farescope/)

Search whole regions and date windows at once ("Austin → anywhere in Japan, leaving any day Jan–Apr, 7–12 nights") to find the cheapest flights. The app also shows lodging for the chosen dates and saves trips to compare total cost. Results stream onto a 3D globe and a price calendar.

The demo uses simulated prices and runs entirely in your browser. Saved trips stay in that browser. Real prices come from the API server described below.

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
- The airport list is a curated ~125 major airports. Generate it from OurAirports for full coverage.
