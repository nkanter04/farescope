# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## Project

**Tripica** (formerly Farescope; the repo, `@farescope/*` packages, storage keys and demo URL keep the old name for now) finds the **cheapest trip across wide ranges** of places, dates and trip lengths. For example, "Austin → anywhere in Japan, leaving any day Jan–Apr, 7–12 nights." Results stream onto a 3D globe and a price calendar. You can add lodging and save or compare trips by total cost. Live demo (simulated prices): https://nkanter04.github.io/farescope/

The long-term goal is a **multi-stop trip planner**: flights and drives between stops, hotels at each stop, and an optimizer that picks the cheapest start date and nights per stop.

## Commands

```bash
npm install
npm run dev:api        # API (Hono on Node) on :8787 (PROVIDER=mock by default)
npm run dev:web        # Vite web on :5180, proxies /api → :8787
npm run dev -w @farescope/web -- --mode demo   # web with in-browser engine, no API
npm test               # Vitest (all workspaces)
npx vitest run apps/api/src/search             # a single test folder/file
npm run typecheck      # tsc for shared, api, web
npm run build:demo -w @farescope/web           # static GitHub Pages build
npm run backtest       # price-forecast accuracy (real price_history if ≥30 flights, else simulated)
npm run guides:fetch   # refresh cached guide data (NASA POWER climate, Nager.Date holidays) → data/guides/raw
npm run guides:build   # render static guide pages + sitemap into apps/web/dist (run after build:demo)
npm run build:cf       # live-site build for Cloudflare (web app in API mode + guides)
npm run dev:cf         # run the Cloudflare Worker + Durable Object locally (wrangler dev; add --var PROVIDER:mock)
npm run deploy:cf      # build:cf + wrangler deploy (after `npx wrangler login`)
```

Requires Node 22.13+ (built-in `node:sqlite`). Before calling work done, run `npm run typecheck` and `npm test`. If the UI changed, check it in a browser at desktop width and at 375px (no horizontal scroll, no console errors).

## Architecture

npm-workspaces monorepo, TypeScript only, ES modules, explicit `.ts` import extensions (TS source runs directly via Vite/tsx, with no compile step).

- **Airlines:** `packages/shared/src/airlines.ts` is the catalog (IATA code, name, brand color, alliance), with `fareCarriers()` and `fareMatchesAirlines()`. `SearchRequest.airlines` (IATA codes, empty = any) filters results instantly in the UI (`AirlineFilter`) and is sent to providers (SerpApi `include_airlines`; the mock honors it). Legs carry `airlineCode` and a provider `airlineLogo`. Logos come from the provider, else Google's airline-logo CDN for catalog codes only, else a brand-colored code badge (`AirlineLogo`).
- `packages/shared`: types and zod schemas (`SearchRequestSchema`, `Fare`, `Stay`, `TripPlan`, `LodgingStop`, `SearchEvent`, `TripShareSchema`), trip math (`tripStops`, `tripTotal`, `lodgingCoverage`, `comparableTrips` in `trips.ts`), the place resolver (tokens `AUS`, `city:Tokyo|JP`, `country:JP`, `region:Asia`, `anywhere`), and UTC date helpers.
  - **Places:** airport codes, `city:Tokyo|JP`, `state:US-TX` (US airports carry `state`), `country:JP`, `region:Asia`, `anywhere`. Countries, US states and regions carry Google place IDs (kgmid) from Wikidata in `src/data/place-ids.json`; the live grids use them.
  - **Airports:** 4,007 scheduled-service airports from OurAirports (`src/data/airports.json`, `countries.json`), merged with a hand-curated list in `airports.ts`. Each airport has a `tier` (major/regional/local) computed from route counts. **Country, region and "Anywhere" expand to major airports only**, while cities and IATA codes reach every airport. See `DATA_SOURCES.md`. To regenerate, run `scripts/import-airports.ps1`, which also runs `scripts/airport-tiers.ts`.
- `apps/api`: the HTTP API is a runtime-neutral **Hono** app (`api.ts`, no Node imports). `app.ts` + `server.ts` run it on Node (local dev, tests via `test-inject.ts`); `cloudflare/worker.ts` runs it on Cloudflare (production). Storage classes take a small `SqlDb` interface (`sql.ts`): Node's `node:sqlite` in `db.ts`, Durable Object SQLite in `cloudflare/do-sql.ts` (transactions via `transactionSync`). Settings come from env vars in `settings.ts` (shared) + `config.ts` (Node extras).
  - `search/planner.ts` expands a request into provider calls: (origin chunk × destination chunk) × (date × nights).
  - `search/run.ts` runs them in this order: fresh cache hits → **price grids** when the provider has them (SerpApi): `explore` calls for "anywhere"/region destinations (Google Explore, one call per origin × month × trip-length bucket) and `calendar` calls for named places (Google's date grid, one call per route × trip length prices every departure date in up to 121 days) → full itineraries for the cheapest grid dates with the rest of the budget. Providers without grids (mock, Travelpayouts) get an evenly spread sample of exact date pairs plus refinement near the cheapest. It streams `SearchEvent`s as SSE. Very broad searches are capped at 40,000 candidates. `SearchRequest.quick` (the explore page) skips itinerary and lodging lookups.
  - **Price-only fares:** grid results stream as `Fare`s with `priceOnly: true` (no legs; explore ones may name an airline) and, for whole places, `coverage` (Google place IDs + labels like "Japan"). Opening one calls `POST /api/fare-details` (`search/details.ts`, cache-first, 1 quota unit), and the client's `mergeFares` replaces the grid price with the real itineraries (matched by `queryKey`). A real itinerary always replaces its cell's grid price in the stream, even if it costs a bit more.
  - **Google calendar takes one airport or one place ID per side, not a list** (a comma list returns nothing). `planCalendarRoutes` uses a place's Google ID (countries, US states) when it has one and goes airport by airport otherwise (multi-airport cities). Explore without a region stays near the origin (mostly same-continent), like Google's Explore map.
  - **Searches price flights only.** Stays are a separate step: after picking a flight, the trip view looks up lodging per stop through `GET /api/stays` (`search/stays.ts`, cache-first, reserving all its quota units at once). There is no automatic flight + stay bundle (removed: it spent searches on hotels nobody asked for and mixed two decisions).
  - `providers/` holds `mock`, `serpapi-flights`, `serpapi-hotels`, `travelpayouts-flights` (cached Aviasales fares, free for affiliates, one origin → one destination per call, links carry `TRAVELPAYOUTS_MARKER`) and `none` (no stays), behind the `FlightProvider`/`StayProvider` interfaces. The mock builds connections from `providers/routes.ts` (OpenFlights 2014 route graph in `providers/data/routes.json`, ODbL; the demo must keep crediting OpenFlights). `PROVIDER=mock|serpapi|travelpayouts` (`config.ts`). **Real flights are never paired with simulated hotel prices:** with Travelpayouts and no SerpApi key, stays come from `none` and the UI shows booking links only.
  - `cache.ts`/`ttl.ts`, `quota.ts`, `trips.ts`, `db.ts` handle SQLite storage. `history.ts` reads `price_history` for predictions and stores price watches.
  - **Price predictions:** `packages/shared/src/forecast.ts` (pure) learns a booking curve (price vs days-before-departure) from previous flights' price series, blended with a prior, then forecasts one fare from its own history (`PriceTrend`: history, forecast with an 80% band, lowest predicted price, verdict `book | wait | steady`). `search/trend.ts` gathers the data. Live fares use Google's `price_insights.price_history` from the cached search (free, scaled to the fare) plus `price_history` rows. The mock simulates history over the whole ~330-day on-sale window (`mockPriceHistory`); real data has ~60 days from Google plus whatever we've recorded. Route: `POST /api/price-trend {fare, peers}`.
  - **Forecast accuracy:** `shared/forecast-eval.ts` backtests on past prices (k-fold, no future data) against a "no change" baseline, 80%-band coverage and verdict hit rates. Run `npm run backtest`. Judge model changes on **real** `price_history`; tuning on simulated data mostly fits the mock.
  - **Price watches:** `search/watch.ts` re-prices watched flights cache-first, at most every 6 hours, **1 quota unit per live check**. Up to 10 per browser. Routes: `GET/POST/DELETE /api/watches`, `POST /api/watches/check`.
  - `engine.ts` is the browser-safe export (`@farescope/api/engine`).
- `apps/web`: React 19 + Zustand + react-globe.gl.
  - `store.ts` holds state, including the trip `draft` being edited (multi-stop `lodging`, notes, saved `search`).
  - Trip UI: `FarePanel`, `NightPlanner` ("Plan by nights": consecutive stops by city and night count, `nightPlan.ts`), `LodgingEditor` (stays per stop, or "arranged" costs), `TripTimeline` (route with Google Maps transfer links), `TripsView`/`TripComparison`, and read-only share links (`share.ts`, which stores a compressed snapshot in the URL hash and is validated by `TripShareSchema`).
  - The globe (`Globe.tsx`) is lazy-loaded for the Map view.
  - **Explore home** (`ExploreHome.tsx`, `explore/explore.ts`): shown before any search. It runs an origin → `anywhere` round-trip search for a chosen month and lists the cheapest city per destination (Abroad by default). Season labels come from `explore/month-index.json`, generated from the guides by `npm run guides:build` (a test fails if it's stale). It auto-runs only on simulated data; with a live provider it waits for a click, because it costs quota. The logo calls `goHome()`.
  - **Booking links** (`shared/booking.ts`, `affiliates.ts`, `BookLinks.tsx`): flights, stays, hostels, activities and cars. Partner/affiliate URL templates come from the public build variable `VITE_PARTNER_LINKS` (`Name|kind|https://…;;…`, set as a GitHub Actions variable); without one they fall back to plain Google searches. The FTC disclosure shows only when an affiliate link is on screen. Guide pages get the same links (`PlanLinks`). The Travelpayouts **Drive** script (partner 603815, `emrldco.com`) is required by the program and loads in the `<head>` of `index.html` and every guide page (`TP_DRIVE_SRC` in `guides/pages.tsx`). On localhost it logs a 403 "config is not valid", because only the registered domain is allowed.
  - `insights.ts` (a separate Zustand store) holds price trends and watches. UI: `PriceInsight` (verdict card + watch switch, in `FarePanel`), `PriceTrendChart` (SVG, drawn at real pixel width), `WatchedFlights` (in My trips). Watches are re-checked on load and every 30 min while open, and drops trigger a browser notification if allowed.
  - `derived.ts` holds the aggregates shared by the globe, calendar and list.
  - `api.ts` routes calls to `demo.ts` (the in-browser engine) when `MODE === "demo"`.
- **Site layout:** the static **homepage** (`guides/landing.tsx`, marketing page, no prices) is at `/`; the **app** is built by Vite into `dist/app/` and served at `/app/`. Guides and legal pages sit at the root. The app links to them through `SITE_ROOT` (`site.ts`, `"../"`); static pages link into the app with `app/?to=…` (`appLink`). The homepage forwards old app links (`/?to=…`, `/#share=…`) to `/app/`. Preview the whole built site with the `static-site` launch config (a plain static server); `vite preview` only serves `dist/app`.
- **"When to visit" guides** (static, SEO): `packages/shared/src/guides.ts` (pure) turns NASA POWER climate normals + public holidays + curated seasonal events (`data/destinations.json` → `events`) into per-month comfort, demand, labels (Best value / Peak / Shoulder / Off-season), best months and template sentences built only from the numbers. `apps/web/src/guides/` renders `/guides/`, `/guides/<slug>/`, `/guides/month/<month>/`, `sitemap.xml` and `robots.txt` with `react-dom/server` (no client JS). The canonical domain is `SITE_URL`. The pages link into the app with `app/?to=…&depart=YYYY-MM` (`urlSearch.ts`), which pre-fills and runs a search. **Never put simulated prices on guide pages;** a price-by-month section needs real fare data.
- **Themes:** `apps/web/src/themes/daylight.css` is the only shipped stylesheet, loaded at runtime by `theme.ts`. The globe reads `--globe-texture`, `--globe-atmosphere`, `--globe-origin`, `--globe-label`, `--globe-muted-point` and `--globe-arc-scale` from `:root`. Unused drafts live in `design/theme-drafts/`.
- **Deploy:** pushing to `main` runs `.github/workflows/deploy.yml`: typecheck → test → the simulated demo on GitHub Pages, and (once the `CLOUDFLARE_API_TOKEN` secret exists) the live site on Cloudflare: `wrangler.jsonc` serves `apps/web/dist` as static assets and sends `/api/*` to one SQLite-backed Durable Object (`TripicaStore`). Worker secrets (`SERPAPI_KEY`, `TURNSTILE_SECRET_KEY`) are set with `npx wrangler secret put`; public settings (budgets) are `vars` in `wrangler.jsonc`.
- **Privacy, terms and retention:** `apps/web/src/guides/legal.tsx` renders `/privacy/` and `/terms/` with the guide layout (contact from the `CONTACT_EMAIL` build variable). They describe what the code does, so keep them in sync: `api/src/prune.ts` deletes IP-keyed search counters after 31 days and cache entries 30 days past expiry (once a day). Live builds (`TRIPICA_LIVE_BUILD`) add `public/measurement.js`: Cloudflare Web Analytics when `CF_WEB_ANALYTICS_TOKEN` is set, and anonymous booking-click counts (`POST /api/booking-click/<source>/<kind>`, logged by the Worker).
- **Price predictions on live data are hidden** for now (only the watch switch shows) until enough real history exists; the demo still shows simulated ones. Price history is scoped per search (`scoped_history`, keyed by the provider query incl. cabin and party); the older `price_history` table only feeds `npm run backtest`.
- **Accounts (Clerk, optional):** off unless `CLERK_SECRET_KEY` (server) and `VITE_CLERK_PUBLISHABLE_KEY` (web build) are set. The browser sends `Authorization: Bearer <Clerk session token>` (`web/src/auth.ts`); `api/src/auth.ts` verifies it (`@clerk/backend`, works on Workers). A signed-in request uses `user:<id>` for quota (monthly `ACCOUNT_MONTHLY_BUDGET`; visitors keep the daily per-IP `DAILY_CLIENT_BUDGET`) and as the owner of trips and watches; an invalid token gets 401 `{signIn: true}`. `POST /api/account/claim` moves a browser's anonymous trips and watches to the account on first sign-in. Clerk's UI (`components/Account.tsx`) is loaded only when configured (`accountSlots.tsx`), so the demo never downloads it. Clerk development keys work on any domain; production keys need a custom domain.
- **Tripica Pro (Stripe, optional):** on when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` are set and accounts are on. $8.99/month or $79/year (`web/src/pro.ts` must match the Stripe prices; `scripts/stripe-setup.ts` creates them and the customer portal, and writes the IDs to `apps/api/.env`). `api/src/stripe.ts` talks to Stripe's REST API with fetch (no SDK) and verifies webhook signatures with Web Crypto; `subscriptions.ts` stores each user's status. Pro accounts get `PRO_MONTHLY_BUDGET` (500) live lookups a month, trials `TRIAL_BUDGET` (100); one card-required trial per account. Routes: `GET /api/billing`, `POST /api/billing/checkout|portal|sync|webhook`. `sync` confirms a checkout on return (no webhook wait) and `GET /api/billing` re-reads the subscription from Stripe at most every 10 minutes, so renewals and cancellations land even if a webhook is missed. **Never enable Stripe test keys on the public site** (anyone could get Pro with a test card); test locally.
- **Bot check:** with `TURNSTILE_SECRET_KEY` set, routes that can spend live searches (`/api/search`, `/api/fare-details`, `/api/stays`; `/api/watches/check` falls back to cache) need a pass from `POST /api/human` (Cloudflare Turnstile, `turnstile.ts`): an HMAC of the visitor's IP + UTC day. The web app (`human.ts`, `VITE_TURNSTILE_SITE_KEY`) gets one on demand and retries once.

## Rules (must follow)

1. **Never put API keys in the web app or the repo.** The repo is public. Keys belong only in `apps/api/.env` (gitignored); document new ones in `.env.example`.
2. **Every live provider call goes through `QuotaGuard.tryConsume(clientId, units)`** (reserve all units of a multi-call lookup at once). The SerpApi free tier is about 100–250 searches a month. When the budget runs out, serve expired cache entries marked `stale` with a notice. Don't fail.
3. **Keep `search/run.ts`, `search/planner.ts`, `providers/mock.ts`, `ttl.ts` and `engine.ts` free of `node:*` value imports.** The Pages demo bundles them for the browser. `run.ts` depends only on the `SearchCache`/`SearchQuota` interfaces.
4. **UI code must not depend on which provider is active.** Add new data sources as provider adapters.
5. **Tests and scripts must never hit live SerpApi or Travelpayouts.** Use the mock provider or the fixtures in `apps/api/src/fixtures/`. Those fixtures are hand-built from each provider's documented response shape, not recorded (`travelpayouts-aus-tyo.json` notes which fields are still unconfirmed).
6. **Record real fares in `price_history`** (`QueryCache.recordPrices`).
7. **Ask the repo owner before** adding paid services, adding a license, changing product direction, or pushing to `main` (pushing redeploys the live site).

## Conventions

- Strict TS, no `any`. Validate with zod at API boundaries. Dates are `"YYYY-MM-DD"` strings handled in UTC via `packages/shared/src/dates.ts`.
- Vitest tests sit next to the code as `*.test.ts`. Inject `now`/`today` for determinism; use `openDb(":memory:")`; test API routes with `app.inject` and `dbPath: ":memory:"`.
- Styling uses plain class names in the theme CSS. The only inline styles are the price-tint colors from `priceColor()` in `format.ts`.
- Commits: imperative subject, a body explaining why.

## Gotchas

- **SSE disconnects:** `/api/search` streams a `ReadableStream`; a client disconnect aborts the search through the request's `signal` and the stream's `cancel()`, so no more quota is spent.
- **Cloudflare CPU and storage:** one global Durable Object (`idFromName("main")`) holds all state, so the cache and monthly budget are shared. Durable Object SQL is synchronous; never use raw BEGIN/COMMIT there (use `SqlDb.transaction`).
- **Grid overflow:** grid areas that contain the horizontally scrolling calendar need `minmax(0, 1fr)` columns and `min-width: 0`.
- **Stale mock data:** mock results are cached. After editing `providers/mock.ts`, delete `apps/api/.local-data/farescope.sqlite*`.
- **SerpApi round trips:** the price is the round-trip total, but only outbound legs are returned. Return legs would need a second call, which we skip to save quota.
- **Broad places and quota:** a live provider covers about 7 airports per call. Don't widen country/region expansion beyond major airports without accounting for the per-search budget.
- **Guide data is cached in git** (`data/guides/raw`) so builds need no network. NASA POWER values are ~50 km grid averages (e.g. Kyoto reads a few °C cool), and the pages say so. Nager.Date has no holidays for some countries (TH, TW, AE): show "not available", never "none".
- **Predictions are estimates:** the UI must always say what data a prediction used (and "simulated" in the demo), and never present it as a guarantee.
- **No Amadeus:** its Self-Service API closed on 2026-07-17. Airlines publish about 11 months out, so the UI caps dates at today + 330 days.

## Next up

**Go-live for payments (paused by the owner until the product is polished):** (1) owner activates Stripe for Kanter Capital LLC, (2) checks Texas sales tax on subscriptions with an accountant (then `STRIPE_AUTOMATIC_TAX`), (3) buys a custom domain. Then: `scripts/stripe-setup.ts --live --webhook https://<domain>/api/billing/webhook`, Stripe and Clerk production keys as Cloudflare secrets/vars, update hostnames (Clerk, Turnstile, Travelpayouts, `SITE_URL`), deploy, test.


1. Itinerary builder: extend the existing `LodgingStop` trips with flexible nights ranges, a flight/drive mode per leg and a start window. New shared types go in `packages/shared`.
2. Cheapest-dates optimizer: **dynamic programming** over (stop, arrival date), choosing nights per stop. It must be exact, pure and browser-safe. Don't use an LLM for the price math.
3. Driving legs (OSRM) and a 2D map (MapLibre).
4. Real data: SerpApi price grids work locally (calendar, explore, details). Next: host the API so the public site uses them; "Abroad" on the explore page could add per-region explore calls; Travelpayouts' sparse cache would need month-wide queries. Add partner templates (`VITE_PARTNER_LINKS`) once affiliate accounts are approved.
5. Accounts (auth) and a custom domain for the Cloudflare site.
6. Claude API for natural-language trip input and explanations of the results.
