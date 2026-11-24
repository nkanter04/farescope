import type { BookingContext, BookingKind } from "@farescope/shared";
import { linksFor } from "../affiliates.ts";

const VERB: Record<BookingKind, string> = {
  flight: "Book flight on",
  stay: "See hotels on",
  hostel: "See hostels on",
  activity: "Things to do on",
  car: "Rent a car on",
};

/**
 * Outbound "book" buttons. Partner links carry affiliate IDs, so whenever one is shown the FTC
 * disclosure appears right next to it.
 */
export function BookLinks({ kind, ctx, primary = false }: { kind: BookingKind; ctx: BookingContext; primary?: boolean }) {
  const links = linksFor(kind, ctx);
  if (!links.length) return null;
  return (
    <div className="book-links">
      {links.map((l, i) => (
        <a data-booking-kind={kind} data-partner={l.partner} key={l.url} className={primary && i === 0 ? "book-btn primary-link" : "book-btn"} href={l.url} target="_blank" rel="noreferrer sponsored">
          {VERB[kind]} {l.partner} ↗
        </a>
      ))}
      {links.some((l) => l.affiliate) && <span className="muted small disclosure">Tripica may earn a commission if you book through these links.</span>}
    </div>
  );
}
