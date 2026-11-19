import { describe, expect, it } from "vitest";
import { QueryCache } from "./cache.ts";
import { openDb } from "./db.ts";
import { pruneOldData } from "./prune.ts";
import { QuotaGuard } from "./quota.ts";

describe("data retention", () => {
  it("deletes IP-keyed daily counters after 31 days but keeps the monthly total", () => {
    const db = openDb(":memory:");
    const old = new Date("2026-10-01T12:00:00Z");
    const recent = new Date("2026-11-10T12:00:00Z");
    new QuotaGuard(db, { monthlyBudget: 100, dailyClientBudget: 10 }, () => old).tryConsume("ip:203.0.113.7");
    new QuotaGuard(db, { monthlyBudget: 100, dailyClientBudget: 10 }, () => recent).tryConsume("ip:203.0.113.7");
    const now = new Date("2026-11-19T12:00:00Z");
    expect(pruneOldData(db, now).counters).toBe(1);
    const rows = db.prepare("SELECT bucket, period FROM usage ORDER BY bucket, period").all();
    expect(rows).toEqual([
      { bucket: "client:ip:203.0.113.7", period: "2026-11-10" },
      { bucket: "global", period: "2026-10" },
      { bucket: "global", period: "2026-11" },
    ]);
  });

  it("drops cache entries long past expiry but keeps recently expired ones as a fallback", () => {
    const db = openDb(":memory:");
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    const cache = new QueryCache(db, () => t0);
    cache.put("old", "serpapi", { fares: [] }, 86_400_000);
    new QueryCache(db, () => Date.parse("2026-11-15T00:00:00Z")).put("recent", "serpapi", { fares: [] }, 86_400_000);
    expect(pruneOldData(db, new Date("2026-11-19T00:00:00Z")).cache).toBe(1);
    expect(new QueryCache(db).get("recent")).toBeDefined();
    expect(new QueryCache(db).get("old")).toBeUndefined();
  });
});
