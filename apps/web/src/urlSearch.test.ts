import { describe, expect, it } from "vitest";
import { guideForAirport, readUrlSearch } from "./urlSearch.ts";

const TODAY = "2026-11-19";

describe("readUrlSearch", () => {
  it("pre-fills destination and a whole departure month", () => {
    expect(readUrlSearch("?to=city%3AOsaka%7CJP&depart=2027-04", TODAY)).toEqual({
      destinations: ["city:Osaka|JP"],
      departFrom: "2027-04-01",
      departTo: "2027-04-30",
    });
  });

  it("starts at today for the current month and handles December", () => {
    expect(readUrlSearch("?to=HKG&depart=2026-11", TODAY)).toMatchObject({ departFrom: TODAY, departTo: "2026-11-30" });
    expect(readUrlSearch("?to=HKG&depart=2026-12", TODAY)).toMatchObject({ departFrom: "2026-12-01", departTo: "2026-12-31" });
  });

  it("accepts an origin and a single day, and ignores bad input", () => {
    expect(readUrlSearch("?to=HKG&from=AUS&depart=2027-01-05", TODAY)).toEqual({
      destinations: ["HKG"], origins: ["AUS"], departFrom: "2027-01-05", departTo: "2027-01-05",
    });
    expect(readUrlSearch("?to=Narnia", TODAY)).toBeUndefined();
    expect(readUrlSearch("", TODAY)).toBeUndefined();
    expect(readUrlSearch("?to=HKG&from=Nowhere&depart=2020-01", TODAY)).toEqual({ destinations: ["HKG"] });
  });
});

describe("guideForAirport", () => {
  it("finds the guide for a destination airport", () => {
    expect(guideForAirport("BKK")?.slug).toBe("bangkok");
    expect(guideForAirport("KIX")?.slug).toBe("kyoto");
    expect(guideForAirport("ZZZ")).toBeUndefined();
  });
});
