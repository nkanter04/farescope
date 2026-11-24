import { authHeader } from "./auth.ts";
import { browserId, DEMO } from "./api.ts";

/**
 * First-party analytics for the app (the static pages use public/measurement.js). Events go in
 * small batches to POST /api/events: page views, visible time, and key actions. No cookies: a
 * random per-tab session ID plus the anonymous browser ID, which the server hashes. Off in the
 * GitHub Pages demo (there is no API there).
 */
export type TrackName =
  | "page_view" | "search_run" | "fare_open" | "trip_save" | "plan_run" | "booking_click"
  | "signin_prompt" | "signin_open" | "signed_in" | "install_click";

interface Event {
  name: TrackName | "engaged";
  path: string;
  label?: string;
  ref?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  ms?: number;
}

const ENABLED = !DEMO && typeof window !== "undefined";
const queue: Event[] = [];
let lastAuth: Record<string, string> = {};
let path = "/app/";
let visibleSince = typeof document !== "undefined" && document.visibilityState === "visible" ? performance.now() : 0;
let engaged = 0;
const once = new Set<string>();

function sessionId(): string {
  const make = () => (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  try {
    let id = sessionStorage.getItem("tripica.session");
    if (!id) sessionStorage.setItem("tripica.session", (id = make()));
    return id;
  } catch {
    return (sessionId as unknown as { _id?: string })._id ??= make();
  }
}

function send(events: Event[], final: boolean) {
  if (!events.length) return;
  const body = JSON.stringify({ visitor: browserId(), session: sessionId(), events });
  // keepalive lets the last batch leave while the page closes.
  fetch("/api/events", { method: "POST", keepalive: final, headers: { "content-type": "application/json", ...lastAuth }, body }).catch(() => undefined);
}

async function flush(final = false) {
  if (!ENABLED) return;
  noteEngaged();
  if (engaged >= 1000) queue.push({ name: "engaged", path, ms: Math.round(engaged) });
  engaged = 0;
  if (!final) lastAuth = await authHeader().catch(() => ({}));
  while (queue.length) send(queue.splice(0, 25), final);
}

function noteEngaged() {
  if (visibleSince) {
    const now = performance.now();
    engaged += now - visibleSince;
    visibleSince = document.visibilityState === "visible" ? now : 0;
  }
}

/** Record an action. `onceKey` limits it to once per page load (e.g. a prompt being shown). */
export function track(name: TrackName, label?: string, onceKey?: string) {
  if (!ENABLED) return;
  if (onceKey) {
    if (once.has(onceKey)) return;
    once.add(onceKey);
  }
  queue.push({ name, path, label: label?.slice(0, 80) });
}

/** A view inside the app (Search, Plan a trip, My trips…), counted like a page. */
export function trackView(view: string) {
  if (!ENABLED || view === "admin") return;
  const next = view === "search" ? "/app/" : `/app/#${view}`;
  if (next === path) return;
  flush();
  path = next;
  queue.push({ name: "page_view", path });
}

/** Start: the landing page view with where the visitor came from (read before the URL is tidied). */
export function startAnalytics() {
  if (!ENABLED) return;
  const q = new URLSearchParams(location.search);
  const ref = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : undefined;
  queue.push({
    name: "page_view", path, ref,
    utmSource: q.get("utm_source") ?? q.get("ref") ?? undefined,
    utmMedium: q.get("utm_medium") ?? undefined,
    utmCampaign: q.get("utm_campaign") ?? undefined,
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
    else visibleSince = performance.now();
  });
  window.addEventListener("pagehide", () => void flush(true));
  // Booking buttons anywhere in the app: "<kind>:<partner>".
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLElement>("a[data-booking-kind]") : null;
    if (a) track("booking_click", [a.dataset.bookingKind, a.dataset.partner].filter(Boolean).join(":"));
  }, true);
  window.setInterval(() => void flush(), 15_000);
  window.setTimeout(() => void flush(), 3_000);
}
