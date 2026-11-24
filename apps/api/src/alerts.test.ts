import { describe, expect, it } from "vitest";
import type { Fare, PriceWatch } from "@farescope/shared";
import { isDrop, PushStore, runAlerts } from "./alerts.ts";
import { buildApp } from "./app.ts";
import { QueryCache } from "./cache.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { WatchStore } from "./history.ts";
import { isPushEndpoint, parseVapid, vapidHeaders, vapidPublicKey } from "./push.ts";
import type { FlightProvider } from "./providers/types.ts";
import { QuotaGuard } from "./quota.ts";
import { inject } from "./test-inject.ts";

const NOW = new Date("2026-11-24T15:00:00Z");
const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
const leg = { from: "AUS", to: "NRT", depart: "2027-02-02 10:00", arrive: "2027-02-03 14:00", airline: "ANA", flightNumber: "NH 113", durationMin: 900 };
const fare = (price: number): Fare => ({
  id: `f${price}`, provider: "fake", origin: "AUS", destination: "NRT", departDate: "2027-02-02", price, currency: "USD",
  airlines: ["ANA"], stops: 0, durationMin: 900, outbound: [leg], fetchedAt: NOW.toISOString(), cached: false,
});
const watch = (id: string, createdAt: string, price = 900): PriceWatch => ({
  id, fare: fare(price), cabin: "economy", adults: 1, priceAtWatch: price, lastPrice: price,
  lastChecked: "2026-11-01T00:00:00Z", checks: [], createdAt,
});

async function testVapid() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as { privateKey: CryptoKey; publicKey: CryptoKey };
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { vapid: parseVapid(JSON.stringify(jwk), "mailto:test@example.com")!, publicKey: pair.publicKey, jwk };
}

function setup(price: number, budget = 10) {
  const db = openDb(":memory:");
  const push = new PushStore(db);
  const watches = new WatchStore(db);
  let calls = 0;
  const provider: FlightProvider = { name: "fake", live: true, maxAirportsPerSide: 7, search: async () => { calls++; return { fares: [fare(price)] }; } };
  const quota = new QuotaGuard(db, { monthlyBudget: 100, dailyClientBudget: 10 }, () => NOW);
  const sent: string[] = [];
  const deps = {
    push, watches, provider, cache: new QueryCache(db, () => NOW.getTime()), siteUrl: "https://tripica.example",
    quota: { remaining: () => budget, tryConsume: (_id: string, units = 1) => quota.tryConsumeShared("alerts", budget, units) },
    now: () => NOW, send: async (endpoint: string) => { sent.push(endpoint); return "ok" as const; },
  };
  return { db, push, watches, deps, sent, calls: () => calls };
}

describe("push helpers", () => {
  it("accepts only real push services", () => {
    expect(isPushEndpoint(FCM)).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGuQyavXut")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://evil.example.com/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });

  it("signs a VAPID token push services can verify", async () => {
    const { vapid, publicKey } = await testVapid();
    expect(vapidPublicKey(vapid)).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const h = await vapidHeaders(FCM, vapid, NOW);
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization)!;
    expect(key).toBe(vapidPublicKey(vapid));
    const [header, claims, sig] = token.split(".");
    const dec = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(dec(claims)))).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:test@example.com" });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, dec(sig), new TextEncoder().encode(`${header}.${claims}`));
    expect(ok).toBe(true);
    expect(parseVapid("{\"kty\":\"RSA\"}", undefined)).toBeUndefined();
  });

  it("only notifies for real drops", () => {
    expect(isDrop(870, 900)).toBe(true); // $30 and 3.3%
    expect(isDrop(896, 900)).toBe(false); // $4
    expect(isDrop(194, 200)).toBe(true); // $6 = 3%
    expect(isDrop(195, 200)).toBe(false); // $5 is only 2.5%
    expect(isDrop(95, 100)).toBe(true); // $5 floor when 3% is less than $5
  });
});

describe("weekly price-drop alerts", () => {
  it("re-checks the first watched flights weekly and notifies every device of a drop", async () => {
    const { push, watches, deps, sent, calls } = setup(820);
    const { vapid } = await testVapid();
    watches.save("user:a", watch("w1", "2026-11-01T00:00:00Z"));
    watches.save("user:a", watch("w2", "2026-11-02T00:00:00Z"));
    watches.save("user:a", watch("w3", "2026-11-03T00:00:00Z"));
    watches.save("user:a", watch("w4", "2026-11-04T00:00:00Z")); // beyond the first 3: no alerts
    watches.save("user:b", watch("w5", "2026-11-01T00:00:00Z")); // no device: not checked
    push.subscribe("user:a", FCM, NOW);
    push.subscribe("user:a", `${FCM}-phone`, NOW);

    const run = await runAlerts({ ...deps, vapid });
    // One live call (the same flight for all three; the next two come from the cache).
    expect(run).toEqual({ checked: 3, notified: 3, credits: 1, budgetOut: false });
    expect(calls()).toBe(1);
    expect(sent).toHaveLength(6);
    const inbox = push.takeMessages(FCM, NOW);
    expect(inbox[0]).toEqual({ title: "Price drop: Austin → Tokyo", body: expect.stringContaining("Now $820 (was $900)"), url: "https://tripica.example/app/?view=trips" });
    expect(push.takeMessages(FCM, NOW)).toEqual([]);
    expect(watches.list("user:a").find((w) => w.id === "w1")?.lastPrice).toBe(820);

    // A day later: nothing is due (weekly), so no checks and no credits.
    expect(await runAlerts({ ...deps, vapid, now: () => new Date(NOW.getTime() + 86_400_000) })).toMatchObject({ checked: 0, credits: 0 });
  });

  it("doesn't repeat an alert for the same price, and stops when the alert budget is spent", async () => {
    const { push, watches, deps } = setup(820, 0);
    watches.save("user:a", watch("w1", "2026-11-01T00:00:00Z"));
    push.subscribe("user:a", FCM, NOW);
    expect(await runAlerts(deps)).toMatchObject({ checked: 0, budgetOut: true });

    const again = setup(820);
    again.watches.save("user:a", watch("w1", "2026-11-01T00:00:00Z"));
    again.push.subscribe("user:a", FCM, NOW);
    expect((await runAlerts(again.deps)).notified).toBe(1);
    const nextWeek = () => new Date(NOW.getTime() + 8 * 86_400_000);
    expect(await runAlerts({ ...again.deps, now: nextWeek })).toMatchObject({ checked: 1, notified: 0 });
  });

  it("forgets devices the browser unsubscribed, and keeps at most 5 per account", async () => {
    const { push, watches, deps } = setup(820);
    const { vapid } = await testVapid();
    watches.save("user:a", watch("w1", "2026-11-01T00:00:00Z"));
    push.subscribe("user:a", FCM, NOW);
    await runAlerts({ ...deps, vapid, send: async () => "gone" as const });
    expect(push.endpoints("user:a")).toEqual([]);
    for (let i = 0; i < 7; i++) push.subscribe("user:c", `${FCM}-${i}`, new Date(NOW.getTime() + i));
    expect(push.endpoints("user:c")).toHaveLength(5);
  });
});

describe("alert routes", () => {
  const TOKEN = "a-valid-session-token-for-user-a";
  const verifyUser = async (t: string) => (t === TOKEN ? "a" : undefined);
  const auth = { authorization: `Bearer ${TOKEN}` };

  it("subscribes signed-in devices to real push services and hands out the inbox", async () => {
    const { jwk } = await testVapid();
    const app = buildApp(loadConfig({ PROVIDER: "mock", VAPID_PRIVATE_JWK: JSON.stringify(jwk) } as NodeJS.ProcessEnv), { dbPath: ":memory:", verifyUser });
    expect((await inject(app, "/api/push/key")).json()).toMatchObject({ publicKey: expect.any(String), watches: 3 });
    expect((await inject(app, { method: "POST", url: "/api/push/subscribe", payload: { endpoint: FCM } })).statusCode).toBe(401);
    expect((await inject(app, { method: "POST", url: "/api/push/subscribe", headers: auth, payload: { endpoint: "https://evil.example/x" } })).statusCode).toBe(400);
    expect((await inject(app, { method: "POST", url: "/api/push/subscribe", headers: auth, payload: { endpoint: FCM } })).statusCode).toBe(200);
    expect((await inject(app, { method: "POST", url: "/api/push/status", headers: auth, payload: { endpoint: FCM } })).json()).toEqual({ subscribed: true });
    expect((await inject(app, { method: "POST", url: "/api/push/inbox", payload: { endpoint: FCM } })).json()).toEqual({ messages: [] });
    expect((await inject(app, { method: "POST", url: "/api/push/unsubscribe", headers: auth, payload: { endpoint: FCM } })).statusCode).toBe(200);
    expect((await inject(app, { method: "POST", url: "/api/push/status", headers: auth, payload: { endpoint: FCM } })).json()).toEqual({ subscribed: false });
  });

  it("hides alerts without a key, and runs the weekly job only with the cron header", async () => {
    const app = buildApp(loadConfig({ PROVIDER: "mock" } as NodeJS.ProcessEnv), { dbPath: ":memory:", verifyUser });
    expect((await inject(app, "/api/push/key")).statusCode).toBe(404);
    expect((await inject(app, { method: "POST", url: "/api/internal/alerts-run" })).statusCode).toBe(404);
    const run = await inject(app, { method: "POST", url: "/api/internal/alerts-run", headers: { "x-tripica-cron": "1" } });
    expect(run.json()).toEqual({ checked: 0, notified: 0, credits: 0, budgetOut: false });
  });
});
