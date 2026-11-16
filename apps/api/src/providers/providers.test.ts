import { describe, expect, it } from "vitest";
import flightsJson from "../fixtures/serp-flights-aus-japan.json";
import hotelsFixture from "../fixtures/serp-hotels-tokyo.json";
import { createMockFlightProvider, createMockStayProvider } from "./mock.ts";
import { buildFlightParams, createSerpApiFlightProvider, parseFlights, type SerpFlightsResponse } from "./serpapi-flights.ts";

const flightsFixture = flightsJson as unknown as SerpFlightsResponse;
import { buildHotelParams, createSerpApiStayProvider, parseHotels } from "./serpapi-hotels.ts";
import type { FlightQuery } from "./types.ts";

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

describe("serpapi flights", () => {
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
    expect(r.insights).toEqual({ lowestPrice: 1032, typicalRange: [950, 1400], priceLevel: "typical" });
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
