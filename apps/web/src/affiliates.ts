import { bookingLinks, parsePartnerTemplates, type BookingContext, type BookingKind, type BookingLink } from "@farescope/shared";

/**
 * Partner (affiliate) link templates, set at build time with VITE_PARTNER_LINKS: one partner per
 * line (or separated by ";;"), "Name|kind|https://…{placeholders}". Paste each URL from the
 * partner's own link builder after you're approved. Affiliate IDs are public by nature (they're in
 * every link you share), so they can live in build config; API tokens can't (those stay server-side).
 *
 *   VITE_PARTNER_LINKS="Aviasales|flight|https://www.aviasales.com/search/{origin}{departDDMM}{destination}{returnDDMM}{adults}?marker=12345;;Booking.com|stay|https://www.booking.com/searchresults.html?ss={city}&checkin={checkIn}&checkout={checkOut}&group_adults={adults}&aid=67890"
 */
const parsed = parsePartnerTemplates(import.meta.env.VITE_PARTNER_LINKS as string | undefined);
if (parsed.errors.length) console.warn(`Ignored ${parsed.errors.length} malformed partner link line(s).`);

export const PARTNER_TEMPLATES = parsed.templates;

export function linksFor(kind: BookingKind, ctx: BookingContext): BookingLink[] {
  return bookingLinks(kind, ctx, PARTNER_TEMPLATES);
}
