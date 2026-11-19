import { describe, expect, it } from "vitest";
import fixture from "../fixtures/serp-explore-aus-march.json";
import { buildExploreParams, createSerpApiFlightProvider, parseExplore, type SerpExploreResponse } from "./serpapi-flights.ts";
import type { ExploreQuery } from "./types.ts";

const json = fixture as unknown as SerpExploreResponse;
const q: ExploreQuery = { origin: "AUS", month: 3, duration: 2, cabin: "economy", maxStops: null, adults: 1 };

describe("serpapi explore", () => {
  it("builds a month + trip-length request, with an optional region", () => {
    expect(Object.fromEntries(buildExploreParams({ ...q, areaId: "/m/02j9z" }, "KEY"))).toMatchObject({
      engine: "google_travel_explore", departure_id: "AUS", month: "3", type: "1", travel_duration: "2", arrival_area_id: "/m/02j9z", stops: "0",
    });
    const ow = buildExploreParams({ ...q, duration: undefined }, "KEY");
    expect([ow.get("type"), ow.has("travel_duration"), ow.has("arrival_area_id")]).toEqual(["2", false, false]);
  });

  it("keeps priced destinations with an airport, cheapest first", () => {
    expect(parseExplore(json, q)).toEqual([
      { destination: "DEN", name: "Denver", country: "United States", departDate: "2027-04-02", returnDate: "2027-04-09", price: 150, airline: "Southwest", airlineCode: "WN", stops: 0, durationMin: undefined },
      { destination: "LAS", name: "Las Vegas", country: "United States", departDate: "2027-03-01", returnDate: "2027-03-09", price: 199, airline: "Frontier", airlineCode: "F9", stops: 0, durationMin: 180 },
      { destination: "CUN", name: "Cancún", country: "Mexico", departDate: "2027-03-06", returnDate: "2027-03-13", price: 350, airline: "United", airlineCode: "UA", stops: 1, durationMin: 165 },
    ]);
    expect(() => parseExplore({ error: "Invalid API key." }, q)).toThrow(/Invalid/);
  });

  it("calls the explore engine", async () => {
    let called = "";
    const provider = createSerpApiFlightProvider({
      apiKey: "K",
      fetchImpl: (async (url: string) => { called = url; return new Response(JSON.stringify(json)); }) as unknown as typeof fetch,
    });
    expect(await provider.explore!(q)).toHaveLength(3);
    expect(called).toContain("engine=google_travel_explore");
  });
});
