import { describe, expect, it } from "vitest";
import type { Fare } from "@farescope/shared";
import { cheapestByCity, exploreMonths, exploreRequest, MONTH_INDEX } from "./explore.ts";

const fare = (origin: string, destination: string, price: number): Fare => ({
  id: `${origin}${destination}${price}`, provider: "mock", origin, destination, departDate: "2027-03-04", returnDate: "2027-03-11",
  price, currency: "USD", airlines: ["United"], stops: 1, durationMin: 600, outbound: [], fetchedAt: "2026-11-19T00:00:00Z", cached: false,
});

describe("explore", () => {
  it("lists bookable months, starting a week out and capped at 330 days", () => {
    const months = exploreMonths("2026-11-28", 6);
    expect(months.map((m) => m.key)).toEqual(["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"]);
    expect(months[0]).toMatchObject({ departFrom: "2026-12-05", departTo: "2026-12-31" });
    const late = exploreMonths("2026-11-19", 20);
    expect(late.at(-1)).toMatchObject({ key: "2027-10", departTo: "2027-10-15" });
  });

  it("builds a round-trip search to anywhere", () => {
    const [m] = exploreMonths("2026-11-19", 1);
    expect(exploreRequest("AUS", m, 2)).toMatchObject({ origins: ["AUS"], destinations: ["anywhere"], tripType: "roundtrip", adults: 2, departFrom: "2026-11-26", quick: true });
  });

  it("keeps the cheapest fare per city and skips the origin's own city", () => {
    const deals = cheapestByCity([fare("AUS", "NRT", 900), fare("AUS", "HND", 850), fare("AUS", "CUN", 300), fare("IAH", "HOU", 90), fare("AUS", "ZZZ", 1)]);
    expect(deals.map((d) => [d.token, d.fare.price])).toEqual([["city:Cancun|MX", 300], ["city:Tokyo|JP", 850]]);
    expect(deals[1].countryName).toBe("Japan");
    expect(cheapestByCity([fare("AUS", "DAL", 100), fare("AUS", "CUN", 300)], 12, "US").map((d) => d.city)).toEqual(["Cancun"]);
  });

  it("has month labels for every guide", () => {
    expect(MONTH_INDEX.tokyo.labels).toHaveLength(12);
  });
});
