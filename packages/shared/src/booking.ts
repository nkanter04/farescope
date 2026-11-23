/**
 * "Book" links for flights, stays, activities and cars.
 *
 * Partner deep-link formats (and the affiliate IDs inside them) come from each partner's own link
 * builder once you're approved: Travelpayouts/Aviasales, Booking.com, Hostelworld, GetYourGuide,
 * Discover Cars… Rather than guess formats, each partner is a URL TEMPLATE you paste in, with
 * placeholders this module fills:
 *
 *   {origin} {destination}            IATA codes
 *   {depart} {return}                 YYYY-MM-DD      {departDDMM} {returnDDMM}  DDMM
 *   {checkIn} {checkOut}              YYYY-MM-DD      {adults}
 *   {city} {country}                  URL-encoded place names
 *
 * Modifiers: {name?} is optional (empty when unknown, e.g. {returnDDMM?} for one-way trips), and
 * {name:u} encodes the value once more, for a destination nested in a tracker's parameter
 * (Travelpayouts: https://tp.media/r?…&u=https%3A%2F%2Fwww.klook.com%2F…%3Fquery%3D{city:u}).
 *
 * Until a template is set, links fall back to plain (non-affiliate) public searches, so every
 * button works from day one and starts earning as soon as a template is added.
 */

export type BookingKind = "flight" | "stay" | "hostel" | "activity" | "car";

export interface PartnerTemplate {
  /** Shown on the button, e.g. "Booking.com". */
  partner: string;
  kind: BookingKind;
  /** URL with {placeholders}. */
  url: string;
}

export interface BookingLink {
  partner: string;
  url: string;
  /** True when the link carries an affiliate ID (so the page must show a disclosure). */
  affiliate: boolean;
}

export interface BookingContext {
  origin?: string;
  destination?: string;
  depart?: string;
  return?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  city?: string;
  country?: string;
}

const ddmm = (iso?: string) => (iso ? `${iso.slice(8, 10)}${iso.slice(5, 7)}` : "");

/** Fill a template; returns undefined if it needs a value the context doesn't have, or isn't https. */
export function fillTemplate(template: string, ctx: BookingContext): string | undefined {
  const values: Record<string, string | undefined> = {
    origin: ctx.origin,
    destination: ctx.destination,
    depart: ctx.depart,
    return: ctx.return,
    departDDMM: ctx.depart && ddmm(ctx.depart),
    returnDDMM: ctx.return && ddmm(ctx.return),
    checkIn: ctx.checkIn,
    checkOut: ctx.checkOut,
    adults: ctx.adults ? String(ctx.adults) : undefined,
    city: ctx.city && encodeURIComponent(ctx.city),
    country: ctx.country && encodeURIComponent(ctx.country),
  };
  let missing = false;
  const url = template.replace(/\{(\w+)(\?)?(:u)?\}/g, (_, key: string, optional?: string, nested?: string) => {
    const v = values[key];
    if (v === undefined || v === "") {
      if (!optional) missing = true;
      return "";
    }
    return nested ? encodeURIComponent(v) : v;
  });
  return missing || !/^https:\/\//.test(url) ? undefined : url;
}

const q = (s: string) => encodeURIComponent(s);

/** Plain public searches used until partner templates exist. */
export function fallbackLink(kind: BookingKind, ctx: BookingContext): BookingLink | undefined {
  const place = [ctx.city, ctx.country].filter(Boolean).join(", ");
  switch (kind) {
    case "flight":
      if (!ctx.origin || !ctx.destination || !ctx.depart) return undefined;
      return {
        partner: "Google Flights",
        affiliate: false,
        url: `https://www.google.com/travel/flights?q=${q(`Flights from ${ctx.origin} to ${ctx.destination} on ${ctx.depart}${ctx.return ? ` returning ${ctx.return}` : ""}`)}`,
      };
    case "stay":
    case "hostel":
      if (!place) return undefined;
      return {
        partner: "Google Hotels",
        affiliate: false,
        url: `https://www.google.com/travel/search?q=${q(`${kind === "hostel" ? "hostels" : "hotels"} in ${place}`)}${ctx.checkIn ? `&checkin=${ctx.checkIn}&checkout=${ctx.checkOut ?? ""}` : ""}`,
      };
    case "activity":
      if (!place) return undefined;
      return { partner: "Google", affiliate: false, url: `https://www.google.com/search?q=${q(`things to do in ${place}`)}` };
    case "car":
      if (!place) return undefined;
      return { partner: "Google", affiliate: false, url: `https://www.google.com/search?q=${q(`car rental ${place}`)}` };
  }
}

/**
 * Links for one kind of booking: every configured partner whose template can be filled, then the
 * plain fallback if no partner link was possible.
 */
export function bookingLinks(kind: BookingKind, ctx: BookingContext, templates: PartnerTemplate[]): BookingLink[] {
  const out: BookingLink[] = [];
  for (const t of templates) {
    if (t.kind !== kind && !(kind === "hostel" && t.kind === "stay")) continue;
    const url = fillTemplate(t.url, ctx);
    if (url) out.push({ partner: t.partner, url, affiliate: true });
  }
  if (!out.length) {
    const fb = fallbackLink(kind, ctx);
    if (fb) out.push(fb);
  }
  return out;
}

/**
 * Parse partner templates from configuration: one per line, "Partner name|kind|https://…".
 * Lines that don't parse are ignored (and reported), so a typo never breaks the site.
 */
export function parsePartnerTemplates(config: string | undefined): { templates: PartnerTemplate[]; errors: string[] } {
  const templates: PartnerTemplate[] = [];
  const errors: string[] = [];
  const kinds: BookingKind[] = ["flight", "stay", "hostel", "activity", "car"];
  for (const raw of (config ?? "").split(/\r?\n|;;/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [partner, kind, url] = line.split("|").map((s) => s.trim());
    if (!partner || !kinds.includes(kind as BookingKind) || !url?.startsWith("https://")) {
      errors.push(line);
      continue;
    }
    templates.push({ partner, kind: kind as BookingKind, url });
  }
  return { templates, errors };
}
