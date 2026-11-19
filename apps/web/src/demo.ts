/**
 * Browser-only "backend" for the static GitHub Pages demo. It runs the same search engine and
 * mock providers as the API server, with an in-memory cache and trips kept in localStorage.
 */
import { buildPriceTrend, checkWatch, createMockFlightProvider, fareDetails as engineFareDetails, createMockStayProvider, MAX_WATCHES, newWatch, runSearch, ttlFor, type SearchCache } from "@farescope/api/engine";
import { SearchRequestSchema, tripTotal, type Cabin, type Fare, type PriceTrend, type PriceWatch, type QuotaStatus, type SearchEvent, type SearchRequest, type Stay, type TripPlan } from "@farescope/shared";

const memory = new Map<string, { value: unknown; fetchedAt: number; expiresAt: number }>();
const cache: SearchCache = {
  get<T>(key: string) {
    const e = memory.get(key);
    return e ? { value: e.value as T, fetchedAt: e.fetchedAt, expired: e.expiresAt <= Date.now() } : undefined;
  },
  put(key, _provider, value, ttlMs) {
    memory.set(key, { value, fetchedAt: Date.now(), expiresAt: Date.now() + ttlMs });
  },
  recordPrices() {},
};

// latencyMs yields to the browser between calls so the globe and calendar repaint as results arrive.
const flights = createMockFlightProvider({ latencyMs: 1 });
const stays = createMockStayProvider();

export async function streamSearch(req: SearchRequest, onEvent: (e: SearchEvent) => void, signal: AbortSignal): Promise<void> {
  const parsed = SearchRequestSchema.safeParse(req);
  if (!parsed.success) {
    onEvent({ type: "error", message: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  await runSearch(
    parsed.data,
    {
      provider: flights,
      stays,
      cache,
      quota: { remaining: () => Infinity, tryConsume: () => ({ ok: true }) },
      clientId: "demo",
      perSearchBudget: 0,
      freeCallCap: 500,
      concurrency: 8,
      signal,
    },
    onEvent,
  );
}

const noQuota = { remaining: () => Infinity, tryConsume: () => ({ ok: true as const }) };

export function fareDetails(fare: Fare, opts: { cabin: Cabin; maxStops: 0 | 1 | 2 | null; adults: number; airlines?: string[] }) {
  return engineFareDetails({ fare, ...opts }, { provider: flights, cache, quota: noQuota, clientId: "demo" });
}

export async function fetchStays(airport: string, checkIn: string, checkOut: string, adults: number, location?: string) {
  const key = JSON.stringify(["s", airport, checkIn, checkOut, adults, location]);
  const hit = cache.get<Stay[]>(key);
  if (hit && !hit.expired) return { stays: hit.value, cached: true };
  const result = await stays.search({ airport, checkIn, checkOut, adults, location });
  cache.put(key, "mock", result, ttlFor(checkIn, new Date()));
  return { stays: result, cached: false };
}

export function quota(): QuotaStatus {
  return { provider: "mock", live: false, monthlyBudget: 0, monthlyUsed: 0, dailyClientBudget: 0, dailyClientUsed: 0 };
}

const TRIPS_KEY = "farescope.demoTrips";
let memoryTrips: TripPlan[] = [];
function readTrips(): TripPlan[] {
  try {
    return JSON.parse(localStorage.getItem(TRIPS_KEY) ?? "[]") as TripPlan[];
  } catch {
    return memoryTrips;
  }
}
function writeTrips(trips: TripPlan[]) {
  memoryTrips = trips;
  try {
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  } catch {
    /* private mode: keep in memory only */
  }
}

export function listTrips(): TripPlan[] {
  return readTrips();
}

export function saveTrip(input: Omit<TripPlan, "id" | "total" | "createdAt">, id?: string): TripPlan {
  const existing = readTrips().find(trip => trip.id === id);
  if (id && !existing) throw new Error("This trip was deleted. Save a new copy.");
  const trip: TripPlan = {
    ...input,
    id: id ?? crypto.randomUUID(),
    total: tripTotal(input),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  writeTrips([trip, ...readTrips().filter(item => item.id !== trip.id)]);
  return trip;
}

export function deleteTrip(id: string) {
  writeTrips(readTrips().filter((t) => t.id !== id));
}

export function priceTrend(fare: Fare, peers: Fare[]): PriceTrend {
  return buildPriceTrend(fare, peers, { provider: flights, cache });
}

const WATCHES_KEY = "farescope.demoWatches";
let memoryWatches: PriceWatch[] = [];
function readWatches(): PriceWatch[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHES_KEY) ?? "[]") as PriceWatch[];
  } catch {
    return memoryWatches;
  }
}
function writeWatches(watches: PriceWatch[]) {
  memoryWatches = watches;
  try {
    localStorage.setItem(WATCHES_KEY, JSON.stringify(watches));
  } catch {
    /* private mode: keep in memory only */
  }
}

export function listWatches(): PriceWatch[] {
  return readWatches();
}

export function addWatch(fare: Fare, cabin: Cabin, adults: number): PriceWatch {
  const existing = readWatches();
  if (existing.length >= MAX_WATCHES) throw new Error(`You can watch up to ${MAX_WATCHES} flights.`);
  const watch = newWatch(fare, cabin, adults, crypto.randomUUID());
  writeWatches([watch, ...existing]);
  return watch;
}

export function removeWatch(id: string) {
  writeWatches(readWatches().filter((w) => w.id !== id));
}

export async function checkWatches(): Promise<PriceWatch[]> {
  const out: PriceWatch[] = [];
  for (const watch of readWatches()) {
    const { watch: next } = await checkWatch(watch, {
      provider: flights, cache, quota: { remaining: () => Infinity, tryConsume: () => ({ ok: true }) }, clientId: "demo",
    });
    out.push(next);
  }
  writeWatches(out);
  return out;
}
