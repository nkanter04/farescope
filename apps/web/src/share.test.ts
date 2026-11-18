import { describe, expect, it } from "vitest";
import type { TripPlan } from "@farescope/shared";
import { createShareLink, readShareLink } from "./share.ts";

const trip: TripPlan = { id: "1", name: "東京 → Kyoto", notes: "Meet at 京都駅 🚄", adults: 2, total: 999999, createdAt: "2026-11-17",
  fare: { id: "f", provider: "mock", origin: "AUS", destination: "HND", departDate: "2027-04-01", returnDate: "2027-04-08", price: 900,
    currency: "USD", airlines: ["Demo"], stops: 1, durationMin: 1000, outbound: [], cached: false, fetchedAt: "2026-11-17", bookingUrl: "https://example.com/private" },
  lodging: [{ id: "s", place: "Kyoto, Japan", checkIn: "2027-04-03", checkOut: "2027-04-06", ownCost: 300 }] };

describe("read-only itinerary links", () => {
  it("round trips unicode and multiple trips, strips unrelated URLs and recomputes costs", async () => {
    const link = await createShareLink([trip, { ...trip, id: "2" }], "https://example.com/farescope/");
    expect(link).toMatch(/^https:\/\/example.com\/farescope\/#share=/);
    const decoded = await readShareLink(new URL(link).hash);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({ name: trip.name, notes: trip.notes, total: 1200, lodging: trip.lodging });
    expect(decoded[0].fare.bookingUrl).toBeUndefined();
  });
  it("rejects malformed links, oversized payloads and invalid stay dates", async () => {
    await expect(readShareLink("#share=<script>")).rejects.toThrow();
    await expect(readShareLink("#share=" + "a".repeat(24001))).rejects.toThrow();
    await expect(readShareLink("#share=abcd")).rejects.toThrow();
    await expect(createShareLink([{ ...trip, lodging: [{ ...trip.lodging![0], checkOut: "2027-02-30" }] }], "https://example.com")).rejects.toThrow();
    await expect(createShareLink(Array(4).fill(trip), "https://example.com")).rejects.toThrow();
  });
});
