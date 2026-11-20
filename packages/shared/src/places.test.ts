import { describe, expect, it } from "vitest";
import { resolvePlace, resolveAll, suggestPlaces } from "./places.ts";
import { AIRPORTS, COUNTRIES, distanceKm, AIRPORT_BY_IATA } from "./airports.ts";

describe("places", () => {
  it("covers Russia, regional airports and common city aliases", () => {
    expect(suggestPlaces("Russia")[0].token).toBe("country:RU");
    expect(resolvePlace("Russia")?.airports).toContain("SVO");
    expect(resolvePlace("Moscow")?.airports).toContain("DME");
    expect(resolvePlace("Philly")?.airports).toContain("PHL");
    expect(resolvePlace("BOI")?.airports).toEqual(["BOI"]);
    expect(AIRPORTS.length).toBeGreaterThan(3500);
  });
  it("expands broad places to main airports but keeps small ones reachable", () => {
    // Countries use major airports only: the 8 travelers know, not all 83 in the catalog.
    expect(resolvePlace("Japan")?.airports.sort()).toEqual(["CTS", "FUK", "HND", "ITM", "KIX", "NGO", "NRT", "OKA"]);
    expect(resolvePlace("Japan")?.sublabel).toBe("8 main airports");
    expect(resolvePlace("region:Europe")!.airports.length).toBeLessThan(200);
    expect(AIRPORT_BY_IATA.SHB.tier).toBe("local");
    expect(resolvePlace("SHB")?.airports).toEqual(["SHB"]);
    expect(resolvePlace("Nakashibetsu")?.airports).toEqual(["SHB"]);
    // Curated airports stay major even when the 2014 route snapshot predates them.
    expect(AIRPORT_BY_IATA.BER.tier).toBe("major");
    // A country without major or regional airports still resolves to its airports.
    const small = Object.keys(COUNTRIES).find((c) => {
      const all = AIRPORTS.filter((x) => x.country === c);
      return all.length > 0 && all.every((x) => x.tier === "local");
    })!;
    expect(resolvePlace(`country:${small}`)!.airports.length).toBeGreaterThan(0);
  });

  it("puts Middle East countries in the Middle East region", () => {
    for (const code of ["SA", "JO", "OM", "KW", "BH", "AE", "QA", "IL"]) expect(COUNTRIES[code].region).toBe("Middle East");
    const me = resolvePlace("Middle East")!.airports;
    for (const iata of ["RUH", "JED", "AMM", "MCT", "KWI", "DXB", "DOH"]) expect(me).toContain(iata);
    expect(COUNTRIES.GL.region).toBe("North America");
    expect(COUNTRIES.CY.region).toBe("Europe");
    expect(COUNTRIES.TR.region).toBe("Europe");
    expect(COUNTRIES.EG.region).toBe("Africa");
  });

  it("resolves IATA, city, country and region", () => {
    expect(resolvePlace("aus")?.airports).toEqual(["AUS"]);
    expect(resolvePlace("Tokyo")?.airports.sort()).toEqual(["HND", "NRT"]);
    expect(resolvePlace("Japan")?.airports).toContain("KIX");
    expect(resolvePlace("country:JP")?.kind).toBe("country");
    expect(resolvePlace("region:Asia")?.airports).toContain("BKK");
    expect(resolvePlace("anywhere")?.airports.length).toBe(AIRPORTS.filter((x) => x.tier === "major").length);
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
    expect(suggestPlaces("tokyo")[0].label).toBe("Tokyo");
  });

  it("has unique IATA codes and sane distances", () => {
    expect(new Set(AIRPORTS.map((a) => a.iata)).size).toBe(AIRPORTS.length);
    const d = distanceKm(AIRPORT_BY_IATA.AUS, AIRPORT_BY_IATA.NRT);
    expect(d).toBeGreaterThan(10_000);
    expect(d).toBeLessThan(11_000);
  });
});

describe("US states", () => {
  it("resolve by token or name to the state's main airports and Google ID", () => {
    expect(resolvePlace("state:US-TX")).toMatchObject({ kind: "state", label: "Texas", googleId: "/m/07b_l" });
    expect(resolvePlace("state:US-TX")?.airports).toEqual(expect.arrayContaining(["AUS", "DFW", "IAH"]));
    expect(resolvePlace("California")?.token).toBe("state:US-CA");
    expect(resolvePlace("state:US-ZZ")).toBeUndefined();
  });

  it("leave countries and same-named US cities alone", () => {
    expect(resolvePlace("Georgia")?.kind).toBe("country");
    expect(resolvePlace("Washington")?.kind).toBe("city");
    expect(suggestPlaces("georgia").map((p) => p.token)).toEqual(expect.arrayContaining(["country:GE", "state:US-GA"]));
  });

  it("gives countries their Google ID", () => {
    expect(resolvePlace("country:JP")?.googleId).toBe("/m/03_3d");
  });
});

describe("nearest airport", () => {
  it("picks the nearest major airport people drive to, else a regional one", async () => {
    const { nearestAirport } = await import("./airports.ts");
    expect(nearestAirport(30.27, -97.74)?.iata).toBe("AUS"); // downtown Austin
    expect(["SAT", "AUS"]).toContain(nearestAirport(29.88, -97.94)?.iata); // San Marcos, between the two
    expect(nearestAirport(35.68, 139.69)?.city).toBe("Tokyo");
    expect(nearestAirport(0, -140)).toBeUndefined(); // middle of the Pacific
    expect(nearestAirport(Number.NaN, 0)).toBeUndefined();
  });
});
