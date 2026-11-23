import { describe, expect, it } from "vitest";
import { bookingLinks, fallbackLink, fillTemplate, parsePartnerTemplates } from "./booking.ts";

const ctx = { origin: "AUS", destination: "NRT", depart: "2027-04-03", return: "2027-04-12", adults: 2, city: "Tokyo", country: "Japan", checkIn: "2027-04-04", checkOut: "2027-04-12" };

describe("booking links", () => {
  it("fills partner templates, including DDMM dates and encoded places", () => {
    expect(fillTemplate("https://p.example/search/{origin}{departDDMM}{destination}{returnDDMM}{adults}?m=123", ctx)).toBe(
      "https://p.example/search/AUS0304NRT12042?m=123",
    );
    expect(fillTemplate("https://h.example/s?ss={city}%2C+{country}&in={checkIn}", { city: "San José", country: "Costa Rica", checkIn: "2027-01-02" })).toBe(
      "https://h.example/s?ss=San%20Jos%C3%A9%2C+Costa%20Rica&in=2027-01-02",
    );
  });

  it("supports optional values and destinations nested in a tracker link", () => {
    const tpl = "https://tp.media/r?p=1&u=https%3A%2F%2Fa.example%2Fsearch%2F{origin}{departDDMM}{destination}{returnDDMM?}{adults?}";
    expect(fillTemplate(tpl, { origin: "AUS", destination: "NRT", depart: "2027-04-03" })).toBe("https://tp.media/r?p=1&u=https%3A%2F%2Fa.example%2Fsearch%2FAUS0304NRT");
    // City inside u=: encoded twice, so the tracker decodes it back to an encoded query value.
    const city = "https://tp.media/r?p=2&u=https%3A%2F%2Fk.example%2Fsearch%3Fquery%3D{city:u}";
    const filled = fillTemplate(city, { city: "New York" })!;
    expect(filled).toBe("https://tp.media/r?p=2&u=https%3A%2F%2Fk.example%2Fsearch%3Fquery%3DNew%2520York");
    expect(decodeURIComponent(filled.split("&u=")[1])).toBe("https://k.example/search?query=New%20York");
    expect(fillTemplate(city, {})).toBeUndefined();
  });

    it("refuses templates it can't fill or that aren't https", () => {
    expect(fillTemplate("https://p.example/{origin}{destination}", { origin: "AUS" })).toBeUndefined();
    expect(fillTemplate("http://p.example/{origin}", ctx)).toBeUndefined();
  });

  it("uses configured partners, marked as affiliate, else a plain fallback", () => {
    const { templates } = parsePartnerTemplates(
      "Aviasales|flight|https://www.aviasales.com/search/{origin}{departDDMM}{destination}{returnDDMM}{adults}?marker=X\nBooking.com|stay|https://www.booking.com/searchresults.html?ss={city}&aid=1",
    );
    expect(bookingLinks("flight", ctx, templates)).toEqual([{ partner: "Aviasales", affiliate: true, url: "https://www.aviasales.com/search/AUS0304NRT12042?marker=X" }]);
    // Hostels fall back to general stay partners.
    expect(bookingLinks("hostel", ctx, templates)[0].partner).toBe("Booking.com");
    const activity = bookingLinks("activity", ctx, templates);
    expect(activity).toEqual([fallbackLink("activity", ctx)]);
    expect(activity[0].affiliate).toBe(false);
    expect(bookingLinks("flight", ctx, [])[0].url).toMatch(/^https:\/\/www\.google\.com\/travel\/flights\?q=/);
  });

  it("ignores malformed config lines instead of breaking", () => {
    const r = parsePartnerTemplates("# comment\nBad line\nGYG|activity|https://www.getyourguide.com/?q={city}&partner_id=Z;;Cars|boat|https://x");
    expect(r.templates.map((t) => t.partner)).toEqual(["GYG"]);
    expect(r.errors).toEqual(["Bad line", "Cars|boat|https://x"]);
  });
});
