import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { inject } from "./test-inject.ts";
import { QuotaGuard } from "./quota.ts";
import { openDb } from "./db.ts";

const TOKEN = "a-valid-session-token-for-user-1";
const verifyUser = async (token: string) => (token === TOKEN ? "user_1" : undefined);
const auth = { authorization: `Bearer ${TOKEN}` };
const browserA = { "x-client-id": "browser-a-123456" };
const browserB = { "x-client-id": "browser-b-654321" };

function app() {
  const cfg = loadConfig({ PROVIDER: "mock", DAILY_CLIENT_BUDGET: "6", ACCOUNT_MONTHLY_BUDGET: "50" } as NodeJS.ProcessEnv);
  return buildApp(cfg, { dbPath: ":memory:", verifyUser });
}

describe("account limits", () => {
  it("gives visitors a daily allowance and accounts a monthly one", () => {
    const db = openDb(":memory:");
    let now = new Date("2026-11-19T12:00:00Z");
    const q = new QuotaGuard(db, { monthlyBudget: 1000, dailyClientBudget: 2, accountMonthlyBudget: 5 }, () => now);
    expect(q.tryConsume("ip:1", 2)).toEqual({ ok: true });
    expect(q.tryConsume("ip:1")).toEqual({ ok: false, reason: "daily" });
    expect(q.tryConsume("user:u", 5)).toEqual({ ok: true });
    now = new Date("2026-11-20T12:00:00Z"); // next day: visitors reset, accounts don't
    expect(q.tryConsume("ip:1")).toEqual({ ok: true });
    expect(q.tryConsume("user:u")).toEqual({ ok: false, reason: "account" });
    expect(q.status("user:u")).toMatchObject({ scope: "account", clientPeriod: "month", clientBudget: 5, clientUsed: 5 });
    now = new Date("2026-12-01T00:00:00Z"); // new month
    expect(q.tryConsume("user:u")).toEqual({ ok: true });
  });
});

describe("sign-in", () => {
  it("reports the account's allowance and that accounts exist", async () => {
    const a = app();
    expect((await inject(a, "/api/quota")).json()).toMatchObject({ accounts: true, scope: "visitor", clientPeriod: "day", clientBudget: 6 });
    expect((await inject(a, { url: "/api/quota", headers: auth })).json()).toMatchObject({ scope: "account", clientPeriod: "month", clientBudget: 50 });
  });

  it("refuses an invalid token so the browser can refresh it", async () => {
    const a = app();
    const res = await inject(a, { url: "/api/trips", headers: { ...browserA, authorization: "Bearer not-a-valid-session-token-x" } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ signIn: true });
  });

  it("moves a browser's trips and watches to the account, then shows them on any browser", async () => {
    const a = app();
    const fare = { id: "f1", price: 1000, origin: "AUS", destination: "HND" };
    await inject(a, { method: "POST", url: "/api/trips", headers: browserA, payload: { name: "Japan", fare } });
    const claim = await inject(a, { method: "POST", url: "/api/account/claim", headers: { ...browserA, ...auth } });
    expect(claim.json()).toEqual({ trips: 1, watches: 0 });
    // Signed in from another browser: the trip is there. Signed out on the first: it moved.
    expect((await inject(a, { url: "/api/trips", headers: { ...browserB, ...auth } })).json().trips).toHaveLength(1);
    expect((await inject(a, { url: "/api/trips", headers: browserA })).json().trips).toHaveLength(0);
    expect((await inject(a, { method: "POST", url: "/api/account/claim", headers: browserA })).statusCode).toBe(401);
  });

  it("works without accounts when sign-in isn't configured", async () => {
    const plain = buildApp(loadConfig({ PROVIDER: "mock" } as NodeJS.ProcessEnv), { dbPath: ":memory:" });
    expect((await inject(plain, "/api/quota")).json()).toMatchObject({ accounts: false, scope: "visitor" });
    // A stray Authorization header is ignored when accounts are off.
    expect((await inject(plain, { url: "/api/trips", headers: { ...browserA, ...auth } })).statusCode).toBe(200);
  });
});
