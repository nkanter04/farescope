import { liveFetch } from "./human.ts";
import { authHeader } from "./auth.ts";
import type { Cabin, Fare, LodgingStop, PriceTrend, PriceWatch, QuotaStatus, SearchEvent, SearchRequest, Stay, TripPlan } from "@farescope/shared";

function clientId(): string {
  const make = () => (crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  try {
    let id = localStorage.getItem("farescope.clientId");
    if (!id) {
      id = make();
      localStorage.setItem("farescope.clientId", id);
    }
    return id;
  } catch {
    return (clientId as unknown as { _id?: string })._id ??= make();
  }
}

/** Static GitHub Pages build (`vite build --mode demo`): everything runs in the browser. */
export const DEMO = import.meta.env.MODE === "demo";
const demo = () => import("./demo.ts");

/** JSON + this browser's id + the sign-in token when signed in. */
const headers = async (): Promise<Record<string, string>> => ({
  "content-type": "application/json",
  "x-client-id": clientId(),
  ...(await authHeader()),
});

/** POST /api/search and parse the server-sent event stream. */
export async function streamSearch(req: SearchRequest, onEvent: (e: SearchEvent) => void, signal: AbortSignal): Promise<void> {
  if (DEMO) return (await demo()).streamSearch(req, onEvent, signal);
  const res = await liveFetch("/api/search", { method: "POST", headers: await headers(), body: JSON.stringify(req), signal });
  if (!res.ok || !res.body) {
    const msg = await res.json().then((j) => j.error as string).catch(() => `HTTP ${res.status}`);
    onEvent({ type: "error", message: msg });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (block.startsWith("data: ")) onEvent(JSON.parse(block.slice(6)) as SearchEvent);
    }
  }
}

export async function fetchStays(airport: string, stop: LodgingStop, adults: number): Promise<{ stays: Stay[]; stale?: boolean; error?: string }> {
  const { checkIn, checkOut, place } = stop;
  if (DEMO) return (await demo()).fetchStays(airport, checkIn, checkOut, adults, place);
  const qs = new URLSearchParams({ airport, checkIn, checkOut, location: place, adults: String(adults) });
  const res = await liveFetch(`/api/stays?${qs}`, { headers: await headers() });
  const json = await res.json();
  if (!res.ok) return { stays: [], error: json.error ?? `HTTP ${res.status}` };
  return json;
}

export async function fetchQuota(): Promise<QuotaStatus | undefined> {
  if (DEMO) return (await demo()).quota();
  try {
    const r = await fetch("/api/quota", { headers: await headers() });
    return r.ok ? r.json() : undefined;
  } catch {
    return undefined;
  }
}

export async function listTrips(): Promise<TripPlan[]> {
  if (DEMO) return (await demo()).listTrips();
  const r = await fetch("/api/trips", { headers: await headers() });
  return r.ok ? (await r.json()).trips : [];
}

export async function saveTrip(input: Omit<TripPlan, "id" | "total" | "createdAt">, id?: string): Promise<TripPlan> {
  if (DEMO) return (await demo()).saveTrip(input, id);
  const r = await fetch(id ? `/api/trips/${encodeURIComponent(id)}` : "/api/trips", { method: id ? "PUT" : "POST", headers: await headers(), body: JSON.stringify(input) });
  if (!r.ok) throw new Error((await r.json()).error ?? "Could not save trip");
  return (await r.json()).trip;
}

export async function deleteTrip(id: string): Promise<void> {
  if (DEMO) return (await demo()).deleteTrip(id);
  const response = await fetch(`/api/trips/${id}`, { method: "DELETE", headers: await headers() });
  if (!response.ok) throw new Error("Could not delete trip.");
}

/** Real itineraries for a date-grid (price-only) fare. One live lookup unless cached. */
export async function fetchFareDetails(
  fare: Fare,
  opts: { cabin: Cabin; maxStops: 0 | 1 | 2 | null; adults: number; airlines?: string[] },
): Promise<{ fares: Fare[]; error?: string }> {
  if (DEMO) return (await demo()).fareDetails(fare, opts);
  const r = await liveFetch("/api/fare-details", { method: "POST", headers: await headers(), body: JSON.stringify({ fare, ...opts }) });
  if (!r.ok) return { fares: [], error: (await r.json().catch(() => ({}))).error ?? "Could not load these flights." };
  return r.json();
}

/** Price history and prediction for one fare; `peers` (other fares from the search) teach the booking curve. */
export async function fetchPriceTrend(fare: Fare, peers: Fare[]): Promise<PriceTrend> {
  if (DEMO) return (await demo()).priceTrend(fare, peers);
  const r = await fetch("/api/price-trend", { method: "POST", headers: await headers(), body: JSON.stringify({ fare, peers }) });
  if (!r.ok) throw new Error("Could not load the price prediction.");
  return (await r.json()).trend;
}

export async function listWatches(): Promise<PriceWatch[]> {
  if (DEMO) return (await demo()).listWatches();
  const r = await fetch("/api/watches", { headers: await headers() });
  return r.ok ? (await r.json()).watches : [];
}

export async function addWatch(fare: Fare, cabin: Cabin, adults: number): Promise<PriceWatch> {
  if (DEMO) return (await demo()).addWatch(fare, cabin, adults);
  const r = await fetch("/api/watches", { method: "POST", headers: await headers(), body: JSON.stringify({ fare, cabin, adults }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not watch this flight.");
  return (await r.json()).watch;
}

export async function removeWatch(id: string): Promise<void> {
  if (DEMO) return (await demo()).removeWatch(id);
  await fetch(`/api/watches/${encodeURIComponent(id)}`, { method: "DELETE", headers: await headers() });
}

/** Re-price watched flights (cache-first; at most once per 6 hours per flight). */
export async function checkWatches(): Promise<PriceWatch[]> {
  if (DEMO) return (await demo()).checkWatches();
  const r = await liveFetch("/api/watches/check", { method: "POST", headers: await headers(), body: "{}" });
  return r.ok ? (await r.json()).watches : [];
}

/** After sign-in: move this browser's anonymous trips and watches to the account. */
export async function claimAccount(): Promise<void> {
  if (DEMO) return;
  await fetch("/api/account/claim", { method: "POST", headers: await headers(), body: "{}" }).catch(() => undefined);
}
