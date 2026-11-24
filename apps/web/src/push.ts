import { DEMO } from "./api.ts";
import { authHeader } from "./auth.ts";

/**
 * Price-drop alerts on this device (Web Push). The service worker (public/sw.js) shows them.
 * - "needs-install": iPhone/iPad Safari only allows push for apps added to the Home Screen.
 * - "unavailable": the demo, or alerts aren't set up on the server.
 */
export type AlertState = "unsupported" | "needs-install" | "unavailable" | "blocked" | "off" | "on";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

let keyInfo: Promise<{ publicKey: string; watches: number } | undefined> | undefined;
/** The server's push key and how many watched flights get alerts; undefined when alerts are off. */
export function alertConfig() {
  keyInfo ??= DEMO ? Promise.resolve(undefined) : fetch("/api/push/key").then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
  return keyInfo;
}

const post = async (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });

async function subscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.pushManager.getSubscription() ?? null;
}

export async function alertState(): Promise<AlertState> {
  if (DEMO) return "unavailable";
  if (isIOS() && !standalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (!(await alertConfig())) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  const sub = await subscription().catch(() => null);
  if (!sub || Notification.permission !== "granted") return "off";
  const r = await post("/api/push/status", { endpoint: sub.endpoint }).catch(() => undefined);
  return r?.ok && ((await r.json()) as { subscribed?: boolean }).subscribed ? "on" : "off";
}

const toKey = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function enableAlerts(): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await alertConfig();
  if (!cfg) return { ok: false, error: "Alerts aren't available right now." };
  if ((await Notification.requestPermission()) !== "granted") return { ok: false, error: "Notifications are blocked for Tripica in this browser's settings." };
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("sw.js"));
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(cfg.publicKey) }));
    const r = await post("/api/push/subscribe", { endpoint: sub.endpoint });
    if (!r.ok) return { ok: false, error: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't turn on alerts." };
    return { ok: true };
  } catch {
    return { ok: false, error: "This browser couldn't set up notifications." };
  }
}

export async function disableAlerts(): Promise<void> {
  const sub = await subscription().catch(() => null);
  if (!sub) return;
  await post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
