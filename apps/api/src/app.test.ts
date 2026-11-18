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
    const created = await app.inject({ method: "POST", url: "/api/trips", headers: CLIENT, payload: { name: "Japan", adults: 2, fare, stay } });
    expect(created.json().trip.total).toBe(1700);
    const list = await app.inject({ url: "/api/trips", headers: CLIENT });
    expect(list.json().trips).toHaveLength(1);
    expect(list.json().trips[0].adults).toBe(2);
    const other = await app.inject({ url: "/api/trips", headers: { "x-client-id": "someone-else-999" } });
    expect(other.json().trips).toHaveLength(0);
    const del = await app.inject({ method: "DELETE", url: `/api/trips/${created.json().trip.id}`, headers: CLIENT });
    expect(del.statusCode).toBe(200);
  });
  it("updates multi-location trips in place and restricts writes to the owner", async () => {
    const input = { name: "Japan loop", fare: { id: "f2", price: 900 }, notes: "Train to Kyoto",
      lodging: [{ id: "stop", place: "Kyoto, Japan", checkIn: "2027-04-03", checkOut: "2027-04-06", ownCost: 300 }] };
    const created = (await app.inject({ method: "POST", url: "/api/trips", headers: CLIENT, payload: input })).json().trip;
    expect(created.total).toBe(1200);
    const url = `/api/trips/${created.id}`;
    expect((await app.inject({ method: "PUT", url, headers: { "x-client-id": "someone-else-999" }, payload: input })).statusCode).toBe(404);
    const updated = (await app.inject({ method: "PUT", url, headers: CLIENT, payload: { ...input, name: "Kyoto and friends", lodging: [{ ...input.lodging[0], ownCost: 0 }] } })).json().trip;
    expect(updated).toMatchObject({ id: created.id, createdAt: created.createdAt, name: "Kyoto and friends", total: 900, notes: input.notes });
    expect((await app.inject({ url: "/api/trips", headers: CLIENT })).json().trips).toHaveLength(1);
    const invalid = { ...input, lodging: [{ ...input.lodging[0], stay: { id: "wrong-dates", total: 10, checkIn: "2027-04-02", checkOut: "2027-04-06" } }] };
    expect((await app.inject({ method: "PUT", url, headers: CLIENT, payload: invalid })).statusCode).toBe(400);
    expect((await app.inject("/api/stays?airport=HND&location=Kyoto&checkIn=2027-02-30&checkOut=2027-03-04")).statusCode).toBe(400);
  });

  async function searchFares() {
    const res = await app.inject({ method: "POST", url: "/api/search", payload: {
      origins: ["AUS"], destinations: ["Tokyo"], departFrom: "2027-04-01", departTo: "2027-04-03",
      tripType: "roundtrip", minNights: 6, maxNights: 7 } });
    return res.body.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as SearchEvent)
      .flatMap((e) => (e.type === "fare" ? [e.fare] : []));
  }

  it("predicts prices for a fare from the search results", async () => {
    const fares = await searchFares();
    expect(fares[0].queryKey).toMatch(/^f\|/);
    const res = await app.inject({ method: "POST", url: "/api/price-trend", payload: { fare: fares[0], peers: fares.slice(1, 20) } });
    expect(res.statusCode).toBe(200);
    const { trend } = res.json();
    expect(trend.history.length).toBeGreaterThan(30);
    expect(trend.forecast.at(-1).date).toBe(fares[0].departDate);
    expect(["book", "wait", "steady"]).toContain(trend.verdict);
    expect(trend.basis.simulated).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/price-trend", payload: { fare: { ...fares[0], price: -1 } } })).statusCode).toBe(400);
  });

  it("watches flights per browser and re-checks them", async () => {
    const [fare] = await searchFares();
    const created = await app.inject({ method: "POST", url: "/api/watches", headers: CLIENT, payload: { fare, cabin: "economy", adults: 1 } });
    expect(created.statusCode).toBe(200);
    const watch = created.json().watch;
    expect(watch).toMatchObject({ priceAtWatch: fare.price, lastPrice: fare.price, status: "active" });
    expect((await app.inject({ url: "/api/watches", headers: CLIENT })).json().watches).toHaveLength(1);
    expect((await app.inject({ url: "/api/watches", headers: { "x-client-id": "someone-else-999" } })).json().watches).toHaveLength(0);
    const checked = await app.inject({ method: "POST", url: "/api/watches/check", headers: CLIENT });
    expect(checked.json().watches[0].id).toBe(watch.id);
    expect((await app.inject({ method: "DELETE", url: `/api/watches/${watch.id}`, headers: { "x-client-id": "someone-else-999" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/watches/${watch.id}`, headers: CLIENT })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/watches", headers: CLIENT, payload: { fare, cabin: "coach", adults: 1 } })).statusCode).toBe(400);
  });
});
