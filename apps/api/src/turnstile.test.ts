import { describe, expect, it } from "vitest";
import { createApi } from "./api.ts";
import { openDb } from "./db.ts";
import { createMockFlightProvider, createMockStayProvider } from "./providers/mock.ts";
import { inject } from "./test-inject.ts";
import { PASS_HEADER, turnstileGate, turnstileRoutes } from "./turnstile.ts";

const settings = { monthlyBudget: 50, dailyClientBudget: 50, perSearchBudget: 2, freeCallCap: 50 };
const search = { origins: ["AUS"], destinations: ["NRT"], departFrom: "2027-04-01", departTo: "2027-04-02", tripType: "oneway" };

function setup(siteverify: { success: boolean }) {
  const verified: string[] = [];
  const gate = turnstileGate("SECRET", {
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      verified.push(String(init?.body));
      return new Response(JSON.stringify(siteverify));
    }) as unknown as typeof fetch,
    ipOf: (c) => c.req.header("cf-connecting-ip") ?? "unknown",
  });
  // A "live" provider so the gate applies (the mock itself is free).
  const flights = { ...createMockFlightProvider({ today: () => "2026-11-19" }), live: true };
  const app = createApi({
    db: openDb(":memory:"), settings, flights, stays: createMockStayProvider(),
    clientIp: (c) => c.req.header("cf-connecting-ip") ?? "unknown",
    liveGate: gate.check, extend: (a) => turnstileRoutes(a, gate),
  });
  return { app, verified };
}

describe("turnstile gate", () => {
  it("refuses live routes without a pass and allows them with one", async () => {
    const { app, verified } = setup({ success: true });
    const ip = { "cf-connecting-ip": "203.0.113.7" };
    const refused = await inject(app, { method: "POST", url: "/api/search", headers: ip, payload: search });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ needsCheck: true });

    const human = await inject(app, { method: "POST", url: "/api/human", headers: ip, payload: { token: "tok" } });
    expect(verified[0]).toContain("secret=SECRET");
    expect(verified[0]).toContain("remoteip=203.0.113.7");
    const { pass } = human.json();
    const ok = await inject(app, { method: "POST", url: "/api/search", headers: { ...ip, [PASS_HEADER]: pass }, payload: search });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/event-stream");

    // The pass is tied to the visitor's IP.
    const elsewhere = await inject(app, { method: "POST", url: "/api/search", headers: { "cf-connecting-ip": "198.51.100.1", [PASS_HEADER]: pass }, payload: search });
    expect(elsewhere.statusCode).toBe(403);
  });

  it("rejects failed challenges and leaves free routes open", async () => {
    const { app } = setup({ success: false });
    expect((await inject(app, { method: "POST", url: "/api/human", payload: { token: "bad" } })).statusCode).toBe(403);
    expect((await inject(app, "/api/health")).statusCode).toBe(200);
    expect((await inject(app, "/api/quota")).statusCode).toBe(200);
  });
});
