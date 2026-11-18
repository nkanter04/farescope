import { describe, expect, it } from "vitest";
import { AIRLINES, carrierFrom, codeFromFlightNumber, fareCarriers, fareMatchesAirlines, findAirline } from "./airlines.ts";
import type { Fare } from "./types.ts";

const leg = (airline: string, flightNumber: string, extra: object = {}) =>
  ({ from: "AUS", to: "DFW", depart: "", arrive: "", airline, flightNumber, durationMin: 60, ...extra });

describe("airlines", () => {
  it("has unique codes and finds airlines by code, name or alias", () => {
    expect(new Set(AIRLINES.map((a) => a.code)).size).toBe(AIRLINES.length);
    expect(findAirline("NH")?.name).toBe("ANA");
    expect(findAirline("All Nippon Airways")?.code).toBe("NH");
    expect(findAirline("american")?.code).toBe("AA");
    expect(findAirline("Aeroméxico")?.code).toBe("AM");
    expect(findAirline("Nope Air")).toBeUndefined();
  });

  it("reads codes from flight numbers", () => {
    expect(codeFromFlightNumber("AA 2423")).toBe("AA");
    expect(codeFromFlightNumber("NH7")).toBe("NH");
    expect(codeFromFlightNumber("6E 512")).toBe("6E");
    expect(codeFromFlightNumber("Flight 12")).toBeUndefined();
  });

  it("prefers provider logos, falls back to the CDN for known airlines, and to a badge otherwise", () => {
    expect(carrierFrom("United", "UA").logo).toMatch(/\/UA\.png$/);
    expect(carrierFrom("United", "UA", "https://example.com/ua.png").logo).toBe("https://example.com/ua.png");
    const unknown = carrierFrom("Tiny Island Air", "Q9");
    expect(unknown).toMatchObject({ code: "Q9", name: "Tiny Island Air", logo: undefined });
    expect(unknown.color).toMatch(/^hsl/);
    expect(carrierFrom("Japan Airlines")).toMatchObject({ code: "JL", alliance: "oneworld" });
  });

  it("lists a fare's carriers and filters fares flown entirely by allowed airlines", () => {
    const fare = { airlines: ["American", "Japan Airlines"], outbound: [leg("American", "AA 1"), leg("Japan Airlines", "JL 7")] } as Fare;
    expect(fareCarriers(fare).map((c) => c.code)).toEqual(["AA", "JL"]);
    expect(fareMatchesAirlines(fare, [])).toBe(true);
    expect(fareMatchesAirlines(fare, ["AA", "JL", "UA"])).toBe(true);
    expect(fareMatchesAirlines(fare, ["AA"])).toBe(false);
    // Older saved fares without legs still resolve from airline names.
    expect(fareCarriers({ airlines: ["Delta"], outbound: [] } as unknown as Fare)[0].code).toBe("DL");
  });
});
