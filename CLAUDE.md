# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## Project

**Tripica** (formerly Farescope; the repo, `@farescope/*` packages, storage keys and demo URL keep the old name for now) finds the **cheapest trip across wide ranges** of places, dates and trip lengths. For example, "Austin → anywhere in Japan, leaving any day Jan–Apr, 7–12 nights." Results stream onto a 3D globe and a price calendar. You can add lodging and save or compare trips by total cost. Live demo (simulated prices): https://nkanter04.github.io/farescope/

The long-term goal is a **multi-stop trip planner**: flights and drives between stops, hotels at each stop, and an optimizer that picks the cheapest start date and nights per stop.

## Commands

```bash
npm install
npm run dev:api        # Fastify API on :8787 (PROVIDER=mock by default)
npm run dev:web        # Vite web on :5180, proxies /api → :8787
npm run dev -w @farescope/web -- --mode demo   # web with in-browser engine, no API
npm test               # Vitest (all workspaces)
npx vitest run apps/api/src/search             # a single test folder/file
npm run typecheck      # tsc for shared, api, web
npm run build:demo -w @farescope/web           # static GitHub Pages build
npm run backtest       # price-forecast accuracy (real price_history if ≥30 flights, else simulated)
npm run guides:fetch   # refresh cached guide data (NASA POWER climate, Nager.Date holidays) → data/guides/raw
npm run guides:build   # render static guide pages + sitemap into apps/web/dist (run after build:demo)
```

Requires Node 22.13+ (built-in `node:sqlite`). Before calling work done, run `npm run typecheck` and `npm test`. If the UI changed, check it in a browser at desktop width and at 375px (no horizontal scroll, no console errors).

## Architecture

npm-workspaces monorepo, TypeScript only, ES modules, explicit `.ts` import extensions (TS source runs directly via Vite/tsx, with no compile step).

- **Airlines:** `packages/shared/src/airlines.ts` is the catalog (IATA code, name, brand color, alliance), with `fareCarriers()` and `fareMatchesAirlines()`. `SearchRequest.airlines` (IATA codes, empty = any) filters results instantly in the UI (`AirlineFilter`) and is sent to providers (SerpApi `include_airlines`; the mock honors it). Legs carry `airlineCode` and a provider `airlineLogo`. Logos come from the provider, else Google's airline-logo CDN for catalog codes only, else a brand-colored code badge (`AirlineLogo`).
- `packages/shared`: types and zod schemas (`SearchRequestSchema`, `Fare`, `Stay`, `TripPlan`, `LodgingStop`, `SearchEvent`, `TripShareSchema`), trip math (`tripStops`, `tripTotal`, `lodgingCoverage`, `comparableTrips` in `trips.ts`), the place resolver (tokens `AUS`, `city:Tokyo|JP`, `country:JP`, `region:Asia`, `anywhere`), and UTC date helpers.
  - **Airports:** 4,007 scheduled-service airports from OurAirports (`src/data/airports.json`, `countries.json`), merged with a hand-curated list in `airports.ts`. Each airport has a `tier` (major/regional/local) computed from route counts. **Country, region and "Anywhere" expand to major airports only**, while cities and IATA codes reach every airport. See `DATA_SOURCES.md`. To regenerate, run `scripts/import-airports.ps1`, which also runs `scripts/airport-tiers.ts`.
- `apps/api`: Fastify server.
  - `search/planner.ts` expands a request into provider calls: (origin chunk × destination chunk) × (date × nights).
  - `search/run.ts` runs them in this order: fresh cache hits → an evenly spread sample within budget → refinement near the cheapest results. It streams `SearchEvent`s as SSE. Very broad searches are capped at 40,000 candidates.
  - For round trips, `search/shortlist.ts` + `search/stays.ts` then price lodging for up to 4 varied fares (a `shortlist` event, ranked by flight + stay). Lodging reserves its quota units up front and may use at most half the search's live budget.
  - `providers/` holds `mock`, `serpapi-flights` and `serpapi-hotels`, behind the `FlightProvider`/`StayProvider` interfaces. The mock builds connections from `providers/routes.ts` (OpenFlights 2014 route graph in `providers/data/routes.json`, ODbL; the demo must keep crediting OpenFlights).
  - `cache.ts`/`ttl.ts`, `quota.ts`, `trips.ts`, `db.ts` handle SQLite storage. `history.ts` reads `price_history` for predictions and stores price watches.
  - **Price predictions:** `packages/shared/src/forecast.ts` (pure) learns a booking curve (price vs days-before-departure) from previous flights' price series, blended with a prior, then forecasts one fare from its own history (`PriceTrend`: history, forecast with an 80% band, lowest predicted price, verdict `book | wait | steady`). `search/trend.ts` gathers the data. Live fares use Google's `price_insights.price_history` from the cached search (free, scaled to the fare) plus `price_history` rows. The mock simulates history over the whole ~330-day on-sale window (`mockPriceHistory`); real data has ~60 days from Google plus whatever we've recorded. Route: `POST /api/price-trend {fare, peers}`.
  - **Forecast accuracy:** `shared/forecast-eval.ts` backtests on past prices (k-fold, no future data) against a "no change" baseline, 80%-band coverage and verdict hit rates. Run `npm run backtest`. Judge model changes on **real** `price_history`; tuning on simulated data mostly fits the mock.
  - **Price watches:** `search/watch.ts` re-prices watched flights cache-first, at most every 6 hours, **1 quota unit per live check**. Up to 10 per browser. Routes: `GET/POST/DELETE /api/watches`, `POST /api/watches/check`.
  - `engine.ts` is the browser-safe export (`@farescope/api/engine`).
- `apps/web`: React 19 + Zustand + react-globe.gl.
  - `store.ts` holds state, including the trip `draft` being edited (multi-stop `lodging`, notes, saved `search`).
  - Trip UI: `FarePanel`, `LodgingEditor` (stays per stop, or "arranged" costs), `TripTimeline` (route with Google Maps transfer links), `TripsView`/`TripComparison`, and read-only share links (`share.ts`, which stores a compressed snapshot in the URL hash and is validated by `TripShareSchema`).
  - The globe (`Globe.tsx`) is lazy-loaded for the Map view.
  - `insights.ts` (a separate Zustand store) holds price trends and watches. UI: `PriceInsight` (verdict card + watch switch, in `FarePanel`), `PriceTrendChart` (SVG, drawn at real pixel width), `WatchedFlights` (in My trips). Watches are re-checked on load and every 30 min while open, and drops trigger a browser notification if allowed.
  - `derived.ts` holds the aggregates shared by the globe, calendar and list.
  - `api.ts` routes calls to `demo.ts` (the in-browser engine) when `MODE === "demo"`.
- **"When to visit" guides** (static, SEO): `packages/shared/src/guides.ts` (pure) turns NASA POWER climate normals + public holidays + curated seasonal events (`data/destinations.json` → `events`) into per-month comfort, demand, labels (Best value / Peak / Shoulder / Off-season), best months and template sentences built only from the numbers. `apps/web/src/guides/` renders `/guides/`, `/guides/<slug>/`, `/guides/month/<month>/`, `sitemap.xml` and `robots.txt` with `react-dom/server` (no client JS). The canonical domain is `SITE_URL`. The pages link into the app with `?to=…&depart=YYYY-MM` (`urlSearch.ts`), which pre-fills and runs a search. **Never put simulated prices on guide pages;** a price-by-month section needs real fare data.
- **Themes:** `apps/web/src/themes/daylight.css` is the only shipped stylesheet, loaded at runtime by `theme.ts`. The globe reads `--globe-texture`, `--globe-atmosphere`, `--globe-origin`, `--globe-label`, `--globe-muted-point` and `--globe-arc-scale` from `:root`. Unused drafts live in `design/theme-drafts/`.
- **Deploy:** pushing to `main` runs `.github/workflows/deploy.yml` (typecheck → test → demo build → GitHub Pages).

## Rules (must follow)

1. **Never put API keys in the web app or the repo.** The repo is public. Keys belong only in `apps/api/.env` (gitignored); document new ones in `.env.example`.
2. **Every live provider call goes through `QuotaGuard.tryConsume(clientId, units)`** (reserve all units of a multi-call lookup at once). The SerpApi free tier is about 100–250 searches a month. When the budget runs out, serve expired cache entries marked `stale` with a notice. Don't fail.
3. **Keep `search/run.ts`, `search/planner.ts`, `providers/mock.ts`, `ttl.ts` and `engine.ts` free of `node:*` value imports.** The Pages demo bundles them for the browser. `run.ts` depends only on the `SearchCache`/`SearchQuota` interfaces.
4. **UI code must not depend on which provider is active.** Add new data sources as provider adapters.
5. **Tests and scripts must never hit live SerpApi.** Use the mock provider or the fixtures in `apps/api/src/fixtures/`. Those fixtures are hand-built from SerpApi's documented response shape, not recorded.
6. **Record real fares in `price_history`** (`QueryCache.recordPrices`).
7. **Ask the repo owner before** adding paid services, adding a license, changing product direction, or pushing to `main` (pushing redeploys the live site).

## Conventions

- Strict TS, no `any`. Validate with zod at API boundaries. Dates are `"YYYY-MM-DD"` strings handled in UTC via `packages/shared/src/dates.ts`.
- Vitest tests sit next to the code as `*.test.ts`. Inject `now`/`today` for determinism; use `openDb(":memory:")`; test API routes with `app.inject` and `dbPath: ":memory:"`.
- Styling uses plain class names in the theme CSS. The only inline styles are the price-tint colors from `priceColor()` in `format.ts`.
- Commits: imperative subject, a body explaining why.

## Gotchas

- **SSE disconnects:** use `reply.raw.on("close")` and check `writableFinished`. The request's `"close"` event fires as soon as the body is read and would cancel every search.
- **Grid overflow:** grid areas that contain the horizontally scrolling calendar need `minmax(0, 1fr)` columns and `min-width: 0`.
- **Stale mock data:** mock results are cached. After editing `providers/mock.ts`, delete `apps/api/.local-data/farescope.sqlite*`.
- **SerpApi round trips:** the price is the round-trip total, but only outbound legs are returned. Return legs would need a second call, which we skip to save quota.
- **Broad places and quota:** a live provider covers about 7 airports per call. Don't widen country/region expansion beyond major airports without accounting for the per-search budget.
- **Guide data is cached in git** (`data/guides/raw`) so builds need no network. NASA POWER values are ~50 km grid averages (e.g. Kyoto reads a few °C cool), and the pages say so. Nager.Date has no holidays for some countries (TH, TW, AE): show "not available", never "none".
- **Predictions are estimates:** the UI must always say what data a prediction used (and "simulated" in the demo), and never present it as a guarantee.
- **No Amadeus:** its Self-Service API closed on 2026-07-17. Airlines publish about 11 months out, so the UI caps dates at today + 330 days.

## Next up

1. Itinerary builder: extend the existing `LodgingStop` trips with flexible nights ranges, a flight/drive mode per leg and a start window. New shared types go in `packages/shared`.
2. Cheapest-dates optimizer: **dynamic programming** over (stop, arrival date), choosing nights per stop. It must be exact, pure and browser-safe. Don't use an LLM for the price math.
3. Driving legs (OSRM) and a 2D map (MapLibre).
4. Real SerpApi data with budget-aware price-grid fetching.
5. Supabase auth and Postgres, plus API hosting.
6. Claude API for natural-language trip input and explanations of the results.
