import { describe, expect, it } from "vitest";
import fixture from "../fixtures/serp-calendar-aus-japan.json";
import { buildCalendarParams, createSerpApiFlightProvider, parseCalendar, type SerpCalendarResponse } from "./serpapi-flights.ts";
import type { CalendarQuery } from "./types.ts";

const json = fixture as unknown as SerpCalendarResponse;
const q: CalendarQuery = { origins: ["AUS"], destinations: ["NRT", "HND"], rangeStart: "2027-03-01", rangeEnd: "2027-03-31", nights: 7, cabin: "economy", maxStops: 1, adults: 1 };

describe("serpapi calendar", () => {
  it("builds a round-trip date-range request", () => {
    const p = Object.fromEntries(buildCalendarParams({ ...q, airlines: ["NH", "JL"] }, "KEY"));
    expect(p).toMatchObject({
      engine: "google_flights_calendar", departure_id: "AUS", arrival_id: "NRT,HND", date_range_start: "2027-03-01",
      date_range_end: "2027-03-31", type: "1", round_trip_days: "7", stops: "2", include_airlines: "NH,JL", api_key: "KEY",
    });
    const ow = buildCalendarParams({ ...q, nights: undefined }, "KEY");
    expect(ow.get("type")).toBe("2");
    expect(ow.has("round_trip_days")).toBe(false);
  });

  it("keeps valid in-range prices and drops zero, out-of-range and return-less rows", () => {
    expect(parseCalendar(json, q)).toEqual([
      { departDate: "2027-03-01", returnDate: "2027-03-08", price: 1180 },
      { departDate: "2027-03-02", returnDate: "2027-03-09", price: 1043 },
      { departDate: "2027-03-03", returnDate: "2027-03-10", price: 1096 },
    ]);
    expect(parseCalendar({ error: "Google Flights hasn't returned any results for this query." }, q)).toEqual([]);
    expect(() => parseCalendar({ error: "Invalid API key." }, q)).toThrow(/Invalid API key/);
  });

  it("calls the calendar engine", async () => {
    let called = "";
    const provider = createSerpApiFlightProvider({
      apiKey: "K",
      fetchImpl: (async (url: string) => { called = url; return new Response(JSON.stringify(json)); }) as unknown as typeof fetch,
    });
    expect(provider.calendarMaxDays).toBeGreaterThan(0);
    expect(await provider.calendar!(q)).toHaveLength(3);
    expect(called).toContain("engine=google_flights_calendar");
  });
});
