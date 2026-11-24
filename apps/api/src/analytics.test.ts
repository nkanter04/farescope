import { describe, expect, it } from "vitest";
import { Analytics, deviceOf, hashVisitor, isBot, refHost, type EventBatch } from "./analytics.ts";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { QuotaGuard } from "./quota.ts";
import { inject } from "./test-inject.ts";

const NOW = new Date("2026-11-24T15:00:00Z");
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
const batch = (visitor: string, session: string, events: EventBatch["events"]): EventBatch => ({ visitor, session, events });

describe("analytics helpers", () => {
  it("drops bots, sorts devices and reduces referrers to their host", async () => {
    expect(isBot("Googlebot/2.1")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot(CHROME)).toBe(false);
    expect([deviceOf(CHROME), deviceOf(IPHONE), deviceOf("Mozilla/5.0 (iPad; CPU OS 19_0)")]).toEqual(["desktop", "mobile", "tablet"]);
    expect(refHost("https://www.reddit.com/r/travel/comments/x")).toBe("reddit.com");
    expect(refHost("https://tripica.farescope.workers.dev/guides/", "tripica.farescope.workers.dev")).toBeUndefined();
    expect(refHost("not a host!")).toBeUndefined();
    const h = await hashVisitor("browser-a-123456");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain("browser");
  });
});

describe("analytics store", () => {
  it("summarizes visits, time, sources, the sign-up funnel and credits", async () => {
    const a = new Analytics(openDb(":memory:"));
    const ctx = { userAgent: CHROME, signedIn: false, now: NOW, country: "US" };
    await a.record(batch("visitor-one-1", "session-1a", [
      { name: "page_view", path: "/", ref: "reddit.com", utmSource: "Reddit", utmCampaign: "launch" },
      { name: "page_view", path: "/app/" },
      { name: "search_run", path: "/app/" },
      { name: "signin_prompt", path: "/app/" },
      { name: "signin_open", path: "/app/" },
      { name: "engaged", path: "/app/", ms: 90_000 },
    ]), ctx);
    await a.record(batch("visitor-one-1", "session-1a", [{ name: "signed_in", path: "/app/", label: "new" }]), { ...ctx, signedIn: true });
    await a.record(batch("visitor-two-2", "session-2a", [
      { name: "page_view", path: "/guides/kyoto/", ref: "google.com" },
      { name: "booking_click", path: "/guides/kyoto/", label: "activity:Klook" },
      { name: "engaged", path: "/guides/kyoto/", ms: 30_000 },
    ]), { ...ctx, userAgent: IPHONE, country: "GB" });
    expect(await a.record(batch("visitor-bot-3", "session-3a", [{ name: "page_view", path: "/" }]), { ...ctx, userAgent: "AhrefsBot" })).toBe(0);
    expect(a.seeUser("user_1", NOW)).toBe(true);
    expect(a.seeUser("user_1", NOW)).toBe(false);
    a.bump("credits", "visitor", 3, NOW);
    a.bump("credits", "account", 2, NOW);
    a.bump("limit", "daily", 1, NOW);
    a.survey("user_1", { heard: "reddit", age: "25-34" }, NOW);

    const s = a.stats(30, NOW);
    expect(s.totals).toMatchObject({ visitors: 2, sessions: 2, pageViews: 3, signups: 1, accounts: 1, avgEngagedMs: 60_000, medianEngagedMs: 90_000 });
    expect(s.funnel.map((f) => f.sessions)).toEqual([2, 1, 1, 1, 1]);
    expect(s.referrers).toEqual(expect.arrayContaining([{ key: "reddit.com", n: 1 }, { key: "google.com", n: 1 }]));
    expect(s.campaigns).toEqual([{ key: "reddit", n: 1 }]);
    expect(s.countries).toEqual(expect.arrayContaining([{ key: "US", n: 1 }, { key: "GB", n: 1 }]));
    expect(s.devices).toEqual(expect.arrayContaining([{ key: "desktop", n: 1 }, { key: "mobile", n: 1 }]));
    expect(s.credits).toEqual([{ key: "visitor", n: 3 }, { key: "account", n: 2 }]);
    expect(s.limitHits).toEqual([{ key: "daily", n: 1 }]);
    expect(s.bookingClicks).toEqual([{ key: "activity:Klook", n: 1 }]);
    expect(s.survey).toMatchObject({ answers: 1, heard: [{ key: "reddit", n: 1 }], age: [{ key: "25-34", n: 1 }] });
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1)).toMatchObject({ day: "2026-11-24", visitors: 2, signups: 1, credits: 5 });
    expect(s.monthlySignups).toEqual([{ key: "2026-11", n: 1 }]);
    // Stored rows carry a hashed visitor, never the browser ID itself.
    expect(JSON.stringify(s)).not.toContain("visitor-one-1");
  });

  it("offers the sign-up survey once, within a day of signing up", () => {
    const a = new Analytics(openDb(":memory:"));
    a.seeUser("user_2", NOW);
    expect(a.surveyDue("user_2", NOW)).toBe(true);
    expect(a.surveyDue("user_2", new Date(NOW.getTime() + 2 * 86_400_000))).toBe(false);
    a.survey("user_2", { age: "skip" }, NOW);
    expect(a.surveyDue("user_2", NOW)).toBe(false);
    expect(a.surveyDue("someone_else", NOW)).toBe(false);
  });

  it("deletes raw events after 400 days", async () => {
    const db = openDb(":memory:");
    const a = new Analytics(db);
    await a.record(batch("visitor-old-1", "session-old", [{ name: "page_view", path: "/" }]), { userAgent: CHROME, signedIn: false, now: new Date("2025-01-01T00:00:00Z") });
    await a.record(batch("visitor-new-1", "session-new", [{ name: "page_view", path: "/" }]), { userAgent: CHROME, signedIn: false, now: NOW });
    expect(a.prune(NOW)).toBe(1);
    expect(a.stats(365, NOW).totals.visitors).toBe(1);
  });

  it("counts credits and limit hits through the quota guard", () => {
    const db = openDb(":memory:");
    const a = new Analytics(db);
    const q = new QuotaGuard(db, {
      monthlyBudget: 100, dailyClientBudget: 2,
      observe: (id, units, d) => (d.ok ? a.bump("credits", id.startsWith("user:") ? "account" : "visitor", units, NOW) : a.bump("limit", d.reason, 1, NOW)),
    }, () => NOW);
    q.tryConsume("ip:1", 2);
    q.tryConsume("ip:1", 1);
    expect(a.stats(7, NOW)).toMatchObject({ credits: [{ key: "visitor", n: 2 }], limitHits: [{ key: "daily", n: 1 }] });
  });
});

describe("analytics routes", () => {
  const TOKEN = "a-valid-session-token-for-owner";
  const verifyUser = async (t: string) => (t === TOKEN ? "user_owner" : t === "a-valid-session-token-for-other" ? "user_other" : undefined);
  const app = () => buildApp(loadConfig({ PROVIDER: "mock", ADMIN_USER_IDS: "user_owner" } as NodeJS.ProcessEnv), { dbPath: ":memory:", verifyUser });

  it("takes event batches (ignoring junk) and shows stats only to the owner", async () => {
    const a = app();
    const ok = await inject(a, {
      method: "POST", url: "/api/events", headers: { "user-agent": CHROME, "x-visitor-country": "JP" },
      payload: { visitor: "browser-a-123456", session: "session-a-1", events: [{ name: "page_view", path: "/app/", ref: "https://news.ycombinator.com/item" }] },
    });
    expect(ok.statusCode).toBe(204);
    expect((await inject(a, { method: "POST", url: "/api/events", payload: { nope: true } })).statusCode).toBe(204);

    expect((await inject(a, "/api/admin/stats")).statusCode).toBe(401);
    const other = await inject(a, { url: "/api/admin/stats", headers: { authorization: "Bearer a-valid-session-token-for-other" } });
    expect(other.statusCode).toBe(403);
    expect(other.json().userId).toBe("user_other");
    const owner = await inject(a, { url: "/api/admin/stats?days=7", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toMatchObject({ range: { days: 7 }, referrers: [{ key: "news.ycombinator.com", n: 1 }], countries: [{ key: "JP", n: 1 }] });
    // Both signed-in callers were counted as accounts.
    expect(owner.json().totals.accounts).toBe(2);
  });

  it("flags new accounts for the survey and stores the answers", async () => {
    const a = app();
    const headers = { authorization: `Bearer ${TOKEN}`, "x-client-id": "browser-b-123456" };
    expect((await inject(a, { method: "POST", url: "/api/account/claim", headers })).json().newAccount).toBe(true);
    expect((await inject(a, { method: "POST", url: "/api/account/survey", headers, payload: { heard: "friend", age: "35-44" } })).statusCode).toBe(204);
    expect((await inject(a, { method: "POST", url: "/api/account/claim", headers })).json().newAccount).toBe(false);
    expect((await inject(a, { method: "POST", url: "/api/account/survey", headers, payload: {} })).statusCode).toBe(400);
    expect((await inject(a, { method: "POST", url: "/api/account/survey", payload: { heard: "friend" } })).statusCode).toBe(401);
  });
});
