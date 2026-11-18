import { describe, expect, it } from "vitest";
import { comparableTrips, lodgingCoverage, tripStops, tripTotal } from "./trips.ts";
import type { Fare, LodgingStop, Stay, TripPlan } from "./types.ts";

const fare: Fare = { id: "flight", provider: "mock", origin: "AUS", destination: "HND", departDate: "2027-04-01", returnDate: "2027-04-08",
  outbound: [{ from: "AUS", to: "HND", depart: "2027-04-01 12:00", arrive: "2027-04-02 15:00", airline: "Demo", flightNumber: "1", durationMin: 1000 }],
  price: 900, currency: "USD", airlines: ["Demo"], stops: 0, durationMin: 1000, cached: false, fetchedAt: "2026-11-17" };
const stay: Stay = { id: "hotel", provider: "mock", name: "Hotel", kind: "hotel", total: 300, nightly: 150, checkIn: "2027-04-02", checkOut: "2027-04-04", amenities: [] };
const lodging: LodgingStop[] = [
  { id: "one", place: "Tokyo", checkIn: "2027-04-02", checkOut: "2027-04-04", stay },
  { id: "two", place: "Kyoto", checkIn: "2027-04-04", checkOut: "2027-04-07", ownCost: 450 },
  { id: "three", place: "Tokyo", checkIn: "2027-04-07", checkOut: "2027-04-08", ownCost: 0 },
];
const trip: TripPlan = { id: "trip", name: "Japan", fare, adults: 1, lodging, total: 1650, createdAt: "2026-11-17" };

describe("flexible itinerary costs and coverage", () => {
  it("covers six nights from local arrival, across locations including a free night", () => {
    expect(lodgingCoverage(fare, [...lodging].reverse())).toMatchObject({ complete: true, nights: 6, gaps: 0, conflict: false });
    expect(tripTotal(trip)).toBe(1650);
  });
  it("flags gaps, overlaps, out-of-trip dates and unpriced stays", () => {
    expect(lodgingCoverage(fare, [lodging[0], lodging[2]])).toMatchObject({ complete: false, gaps: 3 });
    expect(lodgingCoverage(fare, [...lodging, lodging[0]])).toMatchObject({ complete: false, conflict: true });
    expect(lodgingCoverage(fare, [{ ...lodging[0], checkIn: "2027-04-01" }]).conflict).toBe(true);
    expect(lodgingCoverage(fare, [{ ...lodging[2], checkOut: "2027-04-09" }]).conflict).toBe(true);
    expect(lodgingCoverage(fare, [{ ...lodging[0], stay: undefined }]).unpriced).toBe(1);
    expect(lodgingCoverage(fare, [{ ...lodging[0], checkIn: "" }]).gaps).toBe(6);
  });
  it("migrates old single stays without double counting or restoring removed stays", () => {
    expect(tripStops({ fare, stay })).toHaveLength(1);
    expect(tripTotal({ fare, stay })).toBe(1200);
    expect(tripTotal({ ...trip, stay })).toBe(1650);
    expect(tripTotal({ fare, stay, lodging: [] })).toBe(900);
  });
  it("only compares fully planned costs with matching travelers and trustworthy price scope", () => {
    expect(comparableTrips([trip, { ...trip, id: "second" }])).toBe(true);
    expect(comparableTrips([trip, { ...trip, lodging: [lodging[0]] }])).toBe(false);
    expect(comparableTrips([trip, { ...trip, adults: 2 }])).toBe(false);
    expect(comparableTrips([trip, { ...trip, fare: { ...fare, stale: true } }])).toBe(false);
    expect(comparableTrips([trip, { ...trip, lodging: lodging.map(stop => stop.stay ? { ...stop, stay: { ...stay, provider: "serpapi", totalBasis: "nightly-estimate" } } : stop) }])).toBe(false);
    expect(lodgingCoverage({ ...fare, returnDate: undefined }, lodging).complete).toBe(false);
  });
});
