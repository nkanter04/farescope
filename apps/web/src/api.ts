import type { Fare, QuotaStatus, SearchEvent, SearchRequest, Stay, TripPlan } from "@farescope/shared";

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

const headers = () => ({ "content-type": "application/json", "x-client-id": clientId() });

/** POST /api/search and parse the server-sent event stream. */
export async function streamSearch(req: SearchRequest, onEvent: (e: SearchEvent) => void, signal: AbortSignal): Promise<void> {
  if (DEMO) return (await demo()).streamSearch(req, onEvent, signal);
  const res = await fetch("/api/search", { method: "POST", headers: headers(), body: JSON.stringify(req), signal });
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

export async function fetchStays(fare: Fare, adults: number): Promise<{ stays: Stay[]; stale?: boolean; error?: string }> {
  const checkIn = fare.outbound.at(-1)?.arrive.slice(0, 10) || fare.departDate;
  const checkOut = fare.returnDate ?? addDaysLocal(checkIn, 3);
  if (DEMO) return (await demo()).fetchStays(fare.destination, checkIn, checkOut, adults);
  const qs = new URLSearchParams({ airport: fare.destination, checkIn, checkOut, adults: String(adults) });
  const res = await fetch(`/api/stays?${qs}`, { headers: headers() });
  const json = await res.json();
  if (!res.ok) return { stays: [], error: json.error ?? `HTTP ${res.status}` };
  return json;
}

function addDaysLocal(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export async function fetchQuota(): Promise<QuotaStatus | undefined> {
  if (DEMO) return (await demo()).quota();
  try {
    const r = await fetch("/api/quota", { headers: headers() });
    return r.ok ? r.json() : undefined;
  } catch {
    return undefined;
  }
}

export async function listTrips(): Promise<TripPlan[]> {
  if (DEMO) return (await demo()).listTrips();
  const r = await fetch("/api/trips", { headers: headers() });
  return r.ok ? (await r.json()).trips : [];
}

export async function saveTrip(name: string, fare: Fare, stay?: Stay): Promise<TripPlan> {
  if (DEMO) return (await demo()).saveTrip(name, fare, stay);
  const r = await fetch("/api/trips", { method: "POST", headers: headers(), body: JSON.stringify({ name, fare, stay }) });
  if (!r.ok) throw new Error((await r.json()).error ?? "Could not save trip");
  return (await r.json()).trip;
}

export async function deleteTrip(id: string): Promise<void> {
  if (DEMO) return (await demo()).deleteTrip(id);
  await fetch(`/api/trips/${id}`, { method: "DELETE", headers: headers() });
}
