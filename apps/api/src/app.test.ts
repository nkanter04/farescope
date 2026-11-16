import { afterAll, describe, expect, it } from "vitest";
import type { SearchEvent } from "@farescope/shared";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const app = buildApp(loadConfig({ PROVIDER: "mock" } as NodeJS.ProcessEnv), { dbPath: ":memory:" });
afterAll(() => app.close());

const CLIENT = { "x-client-id": "test-client-1234" };

describe("api", () => {
  it("streams a search as server-sent events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: {
        origins: ["AUS"],
        destinations: ["Tokyo"],
        departFrom: "2027-04-01",
        departTo: "2027-04-07",
        tripType: "roundtrip",
        minNights: 6,
        maxNights: 8,
      },
    });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = res.body
      .split("\n\n")
      .filter((b) => b.startsWith("data: "))
      .map((b) => JSON.parse(b.slice(6)) as SearchEvent);
    expect(events[0].type).toBe("start");
    expect(events.at(-1)).toMatchObject({ type: "done", providerCalls: 21 });
    expect(events.filter((e) => e.type === "fare").length).toBeGreaterThan(21);
  });

  it("rejects invalid searches", async () => {
    const res = await app.inject({ method: "POST", url: "/api/search", payload: { origins: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("returns stays and caches them", async () => {
    const url = "/api/stays?airport=HND&checkIn=2027-04-02&checkOut=2027-04-09";
    const a = await app.inject(url);
    expect(a.json().stays.length).toBeGreaterThan(5);
    expect(a.json().cached).toBe(false);
    expect((await app.inject(url)).json().cached).toBe(true);
  });

  it("saves, lists and deletes trips per client", async () => {
    const fare = { id: "f1", price: 1000, origin: "AUS", destination: "HND" };
    const stay = { id: "s1", total: 700 };
    const created = await app.inject({ method: "POST", url: "/api/trips", headers: CLIENT, payload: { name: "Japan", fare, stay } });
    expect(created.json().trip.total).toBe(1700);
    const list = await app.inject({ url: "/api/trips", headers: CLIENT });
    expect(list.json().trips).toHaveLength(1);
    const other = await app.inject({ url: "/api/trips", headers: { "x-client-id": "someone-else-999" } });
    expect(other.json().trips).toHaveLength(0);
    const del = await app.inject({ method: "DELETE", url: `/api/trips/${created.json().trip.id}`, headers: CLIENT });
    expect(del.statusCode).toBe(200);
  });
});
