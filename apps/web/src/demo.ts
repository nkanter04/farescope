/**
 * Browser-only "backend" for the static GitHub Pages demo. It runs the same search engine and
 * mock providers as the API server, with an in-memory cache and trips kept in localStorage.
 */
import { createMockFlightProvider, createMockStayProvider, runSearch, ttlFor, type SearchCache } from "@farescope/api/engine";
import { SearchRequestSchema, type Fare, type QuotaStatus, type SearchEvent, type SearchRequest, type Stay, type TripPlan } from "@farescope/shared";

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

export async function fetchStays(airport: string, checkIn: string, checkOut: string, adults: number) {
  const key = `s|${airport}|${checkIn}|${checkOut}|${adults}`;
  const hit = cache.get<Stay[]>(key);
  if (hit && !hit.expired) return { stays: hit.value, cached: true };
  const result = await stays.search({ airport, checkIn, checkOut, adults });
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

export function saveTrip(name: string, fare: Fare, stay?: Stay, adults?: number): TripPlan {
  const trip: TripPlan = {
    id: crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}`,
    name,
    fare,
    stay,
    adults,
    total: fare.price + (stay?.total ?? 0),
    createdAt: new Date().toISOString(),
  };
  writeTrips([trip, ...readTrips()]);
  return trip;
}

export function deleteTrip(id: string) {
  writeTrips(readTrips().filter((t) => t.id !== id));
}
