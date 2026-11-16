import { describe, expect, it } from "vitest";
import { resolvePlace, resolveAll, suggestPlaces } from "./places.ts";
import { AIRPORTS, distanceKm, AIRPORT_BY_IATA } from "./airports.ts";

describe("places", () => {
  it("resolves IATA, city, country and region", () => {
    expect(resolvePlace("aus")?.airports).toEqual(["AUS"]);
    expect(resolvePlace("Tokyo")?.airports.sort()).toEqual(["HND", "NRT"]);
    expect(resolvePlace("Japan")?.airports).toContain("KIX");
    expect(resolvePlace("country:JP")?.kind).toBe("country");
    expect(resolvePlace("region:Asia")?.airports).toContain("BKK");
    expect(resolvePlace("anywhere")?.airports.length).toBe(AIRPORTS.length);
    expect(resolvePlace("Atlantis")).toBeUndefined();
  });

  it("unions tokens and reports unknowns", () => {
    const r = resolveAll(["AUS", "city:Dallas|US", "nowhere"]);
    expect(r.airports.sort()).toEqual(["AUS", "DAL", "DFW"]);
    expect(r.unknown).toEqual(["nowhere"]);
  });

  it("suggests the obvious match first", () => {
    expect(suggestPlaces("japan")[0].token).toBe("country:JP");
    expect(suggestPlaces("AUS")[0].token).toBe("AUS");
    expect(suggestPlaces("tok")[0].label).toBe("Tokyo");
  });

  it("has unique IATA codes and sane distances", () => {
    expect(new Set(AIRPORTS.map((a) => a.iata)).size).toBe(AIRPORTS.length);
    const d = distanceKm(AIRPORT_BY_IATA.AUS, AIRPORT_BY_IATA.NRT);
    expect(d).toBeGreaterThan(10_000);
    expect(d).toBeLessThan(11_000);
  });
});
