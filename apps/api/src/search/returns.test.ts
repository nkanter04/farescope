import { describe, expect, it } from "vitest";
import type { Fare } from "@farescope/shared";
import { QueryCache } from "../cache.ts";
import { openDb } from "../db.ts";
import { QuotaGuard } from "../quota.ts";
import { createMockFlightProvider } from "../providers/mock.ts";
import { buildFlightParams, createSerpApiFlightProvider, parseReturns } from "../providers/serpapi-flights.ts";
import type { FlightProvider } from "../providers/types.ts";
import { returnFlights } from "./returns.ts";

const NOW = new Date("2026-11-20T12:00:00Z");
const base = (): Fare => ({
  id: "f", provider: "serpapi", origin: "AUS", destination: "NRT", departDate: "2027-03-02", returnDate: "2027-03-09", price: 1000,
  currency: "USD", airlines: ["ANA"], stops: 1, durationMin: 900, outbound: [], fetchedAt: NOW.toISOString(), cached: false, returnToken: "TOKEN123",
});

// Hand-built in the documented google_flights shape (a departure_token search returns the return legs).
const serpReturns = {
  best_flights: [{
    price: 1043, total_duration: 845,
    flights: [
      { departure_airport: { id: "NRT", time: "2027-03-09 17:05" }, arrival_airport: { id: "SEA", time: "2027-03-09 09:40" }, duration: 535, airline: "Delta", flight_number: "DL 166" },
      { departure_airport: { id: "SEA", time: "2027-03-09 12:15" }, arrival_airport: { id: "AUS", time: "2027-03-09 18:20" }, duration: 245, airline: "Delta", flight_number: "DL 2287" },
    ],
  }],
  other_flights: [{ price: 1000, total_duration: 780, flights: [
    { departure_airport: { id: "NRT", time: "2027-03-09 16:00" }, arrival_airport: { id: "DFW", time: "2027-03-09 13:00" }, duration: 720, airline: "American", flight_number: "AA 60" },
    { departure_airport: { id: "DFW", time: "2027-03-09 15:00" }, arrival_airport: { id: "AUS", time: "2027-03-09 16:00" }, duration: 60, airline: "American", flight_number: "AA 1100" },
  ] }],
};

describe("return flights", () => {
  it("parses SerpApi return options, cheapest first, with airline codes", () => {
    const r = parseReturns(serpReturns);
    expect(r.map((o) => [o.price, o.airlines.join(), o.stops])).toEqual([[1000, "American", 1], [1043, "Delta", 1]]);
    expect(r[0].legs[0]).toMatchObject({ from: "NRT", to: "DFW", airlineCode: "AA", depart: "2027-03-09 16:00" });
    expect(parseReturns({ error: "Google Flights hasn't returned any results for this query." })).toEqual([]);
  });

  it("asks SerpApi with the outbound flight's token", async () => {
    let called = "";
    const provider = createSerpApiFlightProvider({
      apiKey: "K",
      fetchImpl: (async (url: string) => { called = url; return new Response(JSON.stringify(serpReturns)); }) as unknown as typeof fetch,
    });
    expect(await provider.returns!(base(), { cabin: "economy", maxStops: null, adults: 1 })).toHaveLength(2);
    const params = new URL(called).searchParams;
    expect([params.get("departure_token"), params.get("return_date"), params.get("engine")]).toEqual(["TOKEN123", "2027-03-09", "google_flights"]);
    expect(buildFlightParams).toBeTypeOf("function");
  });

  it("costs one live credit, then comes from the cache; refuses fares without a token", async () => {
    let calls = 0;
    const provider: FlightProvider = {
      name: "fake", live: true, maxAirportsPerSide: 7, search: async () => ({ fares: [] }),
      returns: async () => (calls++, parseReturns(serpReturns)),
    };
    const db = openDb(":memory:");
    const quota = new QuotaGuard(db, { monthlyBudget: 10, dailyClientBudget: 10 }, () => NOW);
    const deps = { provider, cache: new QueryCache(db, () => NOW.getTime()), quota, clientId: "ip:1", now: () => NOW };
    const input = { fare: base(), cabin: "economy" as const, maxStops: null, adults: 1 };
    expect((await returnFlights(input, deps)).options).toHaveLength(2);
    expect(await returnFlights(input, deps)).toMatchObject({ cached: true });
    expect(calls).toBe(1);
    expect(quota.remaining("ip:1")).toBe(9);
    expect((await returnFlights({ ...input, fare: { ...base(), returnToken: undefined } }, deps)).error).toMatch(/available/);
  });

  it("simulates return flights in the demo on the return date, priced within the round trip", async () => {
    const mock = createMockFlightProvider({ today: () => "2026-11-20" });
    const { fares } = await mock.search({ origins: ["AUS"], destinations: ["NRT"], departDate: "2027-03-02", returnDate: "2027-03-09", cabin: "economy", maxStops: null, adults: 1 });
    const fare = fares[0];
    expect(fare.returnToken).toBe("mock");
    const options = await mock.returns!(fare, { cabin: "economy", maxStops: null, adults: 1 });
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].legs[0].from).toBe("NRT");
    expect(options[0].legs.at(-1)?.to).toBe("AUS");
    expect(options[0].legs[0].depart.startsWith("2027-03-09")).toBe(true);
    expect(options.every((o) => o.price === fare.price)).toBe(true);
  });
});
