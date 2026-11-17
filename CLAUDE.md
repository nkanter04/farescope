# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## Project

Farescope finds the **cheapest trip across wide ranges** of places, dates and trip lengths. For example, "Austin → anywhere in Japan, leaving any day Jan–Apr, 7–12 nights." Results stream onto a 3D globe and a price calendar. You can add lodging and save or compare trips by total cost. Live demo (simulated prices): https://nkanter04.github.io/farescope/

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
```

Requires Node 22.13+ (built-in `node:sqlite`). Before calling work done, run `npm run typecheck` and `npm test`. If the UI changed, check it in a browser at desktop width and at 375px (no horizontal scroll, no console errors).

## Architecture

npm-workspaces monorepo, TypeScript only, ES modules, explicit `.ts` import extensions (TS source runs directly via Vite/tsx, with no compile step).

- `packages/shared`: types and zod schemas (`SearchRequestSchema`, `Fare`, `Stay`, `TripPlan`, `SearchEvent`), the curated airport list, the place resolver (tokens `AUS`, `city:Tokyo|JP`, `country:JP`, `region:Asia`, `anywhere`), and UTC date helpers.
- `apps/api`: Fastify server.
  - `search/planner.ts` expands a request into provider calls: (origin chunk × destination chunk) × (date × nights).
  - `search/run.ts` runs them in this order: fresh cache hits → an evenly spread sample within budget → refinement near the cheapest results. It streams `SearchEvent`s as SSE.
  - `providers/` holds `mock`, `serpapi-flights` and `serpapi-hotels`, behind the `FlightProvider`/`StayProvider` interfaces.
  - `cache.ts`/`ttl.ts`, `quota.ts`, `trips.ts`, `db.ts` handle SQLite storage.
  - `engine.ts` is the browser-safe export (`@farescope/api/engine`).
- `apps/web`: React 19 + Zustand + react-globe.gl.
  - `store.ts` holds state.
  - `derived.ts` holds the aggregates shared by the globe, calendar and list.
  - `api.ts` routes calls to `demo.ts` (the in-browser engine) when `MODE === "demo"`.
- **Themes:** `apps/web/src/themes/daylight.css` is the only shipped stylesheet, loaded at runtime by `theme.ts`. The globe reads `--globe-texture`, `--globe-atmosphere`, `--globe-origin`, `--globe-label`, `--globe-muted-point` and `--globe-arc-scale` from `:root`. Unused drafts live in `design/theme-drafts/`.
- **Deploy:** pushing to `main` runs `.github/workflows/deploy.yml` (typecheck → test → demo build → GitHub Pages).

## Rules (must follow)

1. **Never put API keys in the web app or the repo.** The repo is public. Keys belong only in `apps/api/.env` (gitignored); document new ones in `.env.example`.
2. **Every live provider call goes through `QuotaGuard.tryConsume`.** The SerpApi free tier is about 100–250 searches a month. When the budget runs out, serve expired cache entries marked `stale` with a notice. Don't fail.
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
- **No Amadeus:** its Self-Service API closed on 2026-07-17. Airlines publish about 11 months out, so the UI caps dates at today + 330 days.

## Next up

1. Itinerary model and builder UI (stops with nights ranges, a flight/drive mode per leg, a start window). New shared types go in `packages/shared`.
2. Cheapest-dates optimizer: **dynamic programming** over (stop, arrival date), choosing nights per stop. It must be exact, pure and browser-safe. Don't use an LLM for the price math.
3. Driving legs (OSRM) and a 2D map (MapLibre).
4. Real SerpApi data with budget-aware price-grid fetching.
5. Supabase auth and Postgres, plus API hosting.
6. Claude API for natural-language trip input and explanations of the results.
