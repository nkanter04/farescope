import { describe, expect, it } from "vitest";
import flightsJson from "../fixtures/serp-flights-aus-japan.json";
import hotelsFixture from "../fixtures/serp-hotels-tokyo.json";
import { createMockFlightProvider, createMockStayProvider } from "./mock.ts";
import { buildFlightParams, createSerpApiFlightProvider, parseFlights, type SerpFlightsResponse } from "./serpapi-flights.ts";

const flightsFixture = flightsJson as unknown as SerpFlightsResponse;
import { buildHotelParams, createSerpApiStayProvider, parseHotels } from "./serpapi-hotels.ts";
import type { FlightQuery } from "./types.ts";
import routes from "./data/routes.json";
import { stayQueryKey } from "./types.ts";

const q: FlightQuery = {
  origins: ["AUS"],
  destinations: ["NRT", "HND", "KIX"],
  departDate: "2027-03-10",
  returnDate: "2027-03-18",
  cabin: "economy",
  maxStops: 1,
  adults: 1,
};

describe("mock provider", () => {
  it("filters real route paths without converting connections into nonstops", async () => {
    const provider = createMockFlightProvider({ today: () => "2026-11-16" });
    for (const [origin, destination] of [["AUS", "HND"], ["PHL", "HKG"]]) {
      const query = { ...q, origins: [origin], destinations: [destination] };
      expect((await provider.search({ ...query, maxStops: 0 })).fares).toEqual([]);
      const connecting = (await provider.search({ ...query, maxStops: 2 })).fares;
      expect(new Set(connecting.map(fare => fare.stops))).toEqual(new Set([1, 2]));
      for (const fare of connecting) {
        expect(fare.stops).toBe(fare.outbound.length - 1);
        for (const leg of fare.outbound) expect((routes as Record<string, string[]>)[leg.from]).toContain(leg.to);
      }
      expect((await provider.search({ ...query, maxStops: 1 })).fares.every(fare => fare.stops === 1)).toBe(true);
    }
    expect((await provider.search({ ...q, origins: ["LAX"], destinations: ["NRT"], maxStops: 0 })).fares[0].stops).toBe(0);
  });
  it("is deterministic and plausible", async () => {
    const p = createMockFlightProvider({ today: () => "2026-11-16" });
    const a = await p.search(q);
    const b = await p.search(q);
    expect(a.fares.map((f) => f.price)).toEqual(b.fares.map((f) => f.price));
    expect(a.fares.length).toBeGreaterThanOrEqual(6);
    for (const f of a.fares) {
      expect(f.price).toBeGreaterThan(300);
      expect(f.price).toBeLessThan(5000);
      expect(f.stops).toBeLessThanOrEqual(1);
      expect(f.outbound.at(-1)!.to).toBe(f.destination);
    }
  });

  it("prices business above economy", async () => {
    const p = createMockFlightProvider({ today: () => "2026-11-16" });
    const eco = (await p.search(q)).fares[0].price;
    const biz = (await p.search({ ...q, cabin: "business" })).fares[0].price;
    expect(biz).toBeGreaterThan(eco * 2);
  });

  it("generates stays of every kind", async () => {
    const stays = await createMockStayProvider().search({ airport: "NRT", checkIn: "2027-03-11", checkOut: "2027-03-18", adults: 1 });
    expect(new Set(stays.map((s) => s.kind))).toEqual(new Set(["hotel", "hostel", "rental"]));
    expect(stays[0].total).toBeLessThanOrEqual(stays.at(-1)!.total);
  });
});

describe("airline filter", () => {
  it("mock only returns itineraries on allowed airlines, with real codes", async () => {
    const p = createMockFlightProvider({ today: () => "2026-11-16" });
    const all = (await p.search(q)).fares;
    const codes = new Set(all.flatMap((f) => f.outbound.map((l) => l.airlineCode)));
    expect(codes.size).toBeGreaterThan(1);
    const pick = [...codes][0]!;
    const only = (await p.search({ ...q, airlines: [pick] })).fares;
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((f) => f.outbound.every((l) => l.airlineCode === pick && l.flightNumber.startsWith(pick)))).toBe(true);
    expect((await p.search({ ...q, airlines: ["ZZ"] })).fares).toEqual([]);
  });

  it("asks SerpApi to filter airlines and keeps provider logos", () => {
    expect(buildFlightParams({ ...q, airlines: ["UA", "NH"] }, "K").get("include_airlines")).toBe("UA,NH");
    expect(buildFlightParams(q, "K").has("include_airlines")).toBe(false);
    const r = parseFlights(flightsFixture, { ...q, airlines: ["UA"] }, "2026-11-16T00:00:00Z");
    expect(r.fares.map((f) => f.airlines)).toEqual([["United"]]);
    expect(r.fares[0].outbound[0]).toMatchObject({ airlineCode: "UA", airlineLogo: expect.stringMatching(/UA\.png$/) });
  });
});

describe("serpapi flights", () => {
  it("rejects connecting offers when nonstop is requested", () => {
    expect(parseFlights(flightsFixture, { ...q, maxStops: 0 }).fares).toEqual([]);
    expect(buildFlightParams({ ...q, maxStops: 2 }, "KEY").get("stops")).toBe("3");
  });
  it("builds multi-airport params", () => {
    const p = buildFlightParams(q, "KEY");
    expect(p.get("departure_id")).toBe("AUS");
    expect(p.get("arrival_id")).toBe("NRT,HND,KIX");
    expect(p.get("type")).toBe("1");
    expect(p.get("stops")).toBe("2");
    expect(p.get("return_date")).toBe("2027-03-18");
  });

  it("parses itineraries and insights from the fixture", () => {
    const r = parseFlights(flightsFixture, q, "2026-11-16T00:00:00Z");
    expect(r.fares.map((f) => [f.origin, f.destination, f.price, f.stops])).toEqual([
      ["AUS", "KIX", 1032, 1],
      ["AUS", "HND", 1184, 1],
    ]);
    expect(r.fares[0].airlines).toEqual(["United"]);
    expect(r.insights).toMatchObject({ lowestPrice: 1032, typicalRange: [950, 1400], priceLevel: "typical" });
    // Google's price history: one lowest price per day, malformed and zero rows dropped.
    const history = r.insights!.history!;
    expect(history).toHaveLength(10);
    expect(history[0]).toEqual({ date: "2026-10-21", price: 1180 });
    expect(history.at(-1)).toEqual({ date: "2026-10-30", price: 1032 });
  });

  it("treats no-results as empty and other errors as failures", () => {
    expect(parseFlights({ error: "Google Flights hasn't returned any results for this query." }, q).fares).toEqual([]);
    expect(() => parseFlights({ error: "Invalid API key." }, q)).toThrow(/Invalid API key/);
  });

  it("calls serpapi.com with the key and parses the response", async () => {
    let calledUrl = "";
    const fakeFetch = (async (url: string) => {
      calledUrl = url;
      return new Response(JSON.stringify(flightsFixture), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createSerpApiFlightProvider({ apiKey: "SECRET", fetchImpl: fakeFetch });
    const r = await p.search(q);
    expect(calledUrl).toMatch(/^https:\/\/serpapi\.com\/search\.json\?/);
    expect(calledUrl).toContain("api_key=SECRET");
    expect(r.fares).toHaveLength(2);
  });
});

describe("serpapi hotels", () => {
  const sq = { airport: "HND", checkIn: "2027-03-11", checkOut: "2027-03-18", adults: 2 };
  it("searches by city name", () => {
    expect(buildHotelParams(sq, "K", false).get("q")).toBe("Tokyo, Japan hotels and hostels");
    expect(buildHotelParams(sq, "K", true).get("vacation_rentals")).toBe("true");
  });
  it("honors locations outside the arrival city and separates their caches", async () => {
    const kyoto = { ...sq, location: "Kyoto, Japan" };
    expect(buildHotelParams(kyoto, "K", false).get("q")).toBe("Kyoto, Japan hotels and hostels");
    expect(stayQueryKey("mock", kyoto)).not.toBe(stayQueryKey("mock", sq));
    expect(stayQueryKey("mock", kyoto)).not.toBe(stayQueryKey("mock", { ...sq, location: "Nara, Japan" }));
    const stays = await createMockStayProvider().search(kyoto);
    expect(stays.every(stay => stay.name.includes("Kyoto, Japan"))).toBe(true);
    expect(stays[0].lat).toBeUndefined();
  });
  it("parses properties, detects hostels, skips unpriced", () => {
    const stays = parseHotels(hotelsFixture, sq, false);
    expect(stays.map((s) => [s.name, s.kind, s.total])).toEqual([
      ["Shinjuku Example Hotel", "hotel", 994],
      ["Asakusa Sample Hostel", "hostel", 31 * 7],
    ]);
  });
  it("reports quota cost per search", () => {
    expect(createSerpApiStayProvider({ apiKey: "k" }).callsPerSearch).toBe(1);
    expect(createSerpApiStayProvider({ apiKey: "k", includeRentals: true }).callsPerSearch).toBe(2);
  });
});
