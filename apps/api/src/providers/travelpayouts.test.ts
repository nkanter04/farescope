import { describe, expect, it } from "vitest";
import fixture from "../fixtures/travelpayouts-aus-tyo.json";
import {
  buildTravelpayoutsParams,
  createTravelpayoutsFlightProvider,
  parseTravelpayouts,
  ticketUrl,
  type TravelpayoutsResponse,
} from "./travelpayouts-flights.ts";
import type { FlightQuery } from "./types.ts";

const json = fixture as unknown as TravelpayoutsResponse;
const q: FlightQuery = { origins: ["AUS"], destinations: ["TYO"], departDate: "2027-04-03", returnDate: "2027-04-12", cabin: "economy", maxStops: null, adults: 1 };

describe("travelpayouts", () => {
  it("builds one-pair, date-specific request params", () => {
    const p = buildTravelpayoutsParams({ ...q, maxStops: 0 });
    expect(p.has("token")).toBe(false);
    expect(Object.fromEntries(p)).toMatchObject({
      origin: "AUS", destination: "TYO", departure_at: "2027-04-03", return_at: "2027-04-12",
      one_way: "false", direct: "true", currency: "usd", sorting: "price",
    });
    expect(buildTravelpayoutsParams({ ...q, returnDate: undefined }).get("one_way")).toBe("true");
  });

  it("maps tickets to fares with airline names, real airports and affiliate links", () => {
    const r = parseTravelpayouts(json, q, "12345", "2026-11-20T00:00:00Z");
    expect(r.fares.map((f) => [f.origin, f.destination, f.price, f.stops, f.airlines[0]])).toEqual([
      ["AUS", "NRT", 987, 2, "United"],
      ["AUS", "HND", 1104, 1, "ANA"],
    ]);
    const ana = r.fares[1];
    expect(ana.outbound[0]).toMatchObject({ airlineCode: "NH", flightNumber: "NH 113", depart: "2027-04-03 10:25", durationMin: 1015 });
    expect(ana.bookingUrl).toBe("https://www.aviasales.com/search/AUS0304TYO12041?t=NH17940000001794060900000101HNDAUS_example&marker=12345");
    expect(r.fares[0].bookingUrl).toBeUndefined(); // no link in that ticket
  });

  it("applies stop and airline filters and multiplies by travelers", () => {
    expect(parseTravelpayouts(json, { ...q, maxStops: 1 }).fares.map((f) => f.destination)).toEqual(["HND"]);
    expect(parseTravelpayouts(json, { ...q, airlines: ["NH"] }).fares).toHaveLength(1);
    expect(parseTravelpayouts(json, { ...q, adults: 2 }).fares[0].price).toBe(1974);
  });

  it("treats 'not found' as no fares and other errors as failures", () => {
    expect(parseTravelpayouts({ success: false, error: "Data not found" }, q).fares).toEqual([]);
    expect(() => parseTravelpayouts({ success: false, error: "Unauthorized" }, q)).toThrow(/Unauthorized/);
    expect(ticketUrl("https://evil.example", "m")).toBeUndefined();
  });

  it("calls the v3 endpoint with the token and parses the response", async () => {
    let called = "";
    let sentToken: string | null = null;
    const provider = createTravelpayoutsFlightProvider({
      token: "SECRET",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        called = url;
        sentToken = new Headers(init?.headers).get("X-Access-Token");
        return new Response(JSON.stringify(json), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(provider).toMatchObject({ name: "travelpayouts", live: true, maxAirportsPerSide: 1 });
    const r = await provider.search(q);
    expect(called).toMatch(/^https:\/\/api\.travelpayouts\.com\/aviasales\/v3\/prices_for_dates\?/);
    expect(called).not.toContain("SECRET");
    expect(sentToken).toBe("SECRET");
    expect(r.fares).toHaveLength(2);
  });
});
