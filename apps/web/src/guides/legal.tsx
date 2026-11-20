/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { ReactNode } from "react";

/**
 * Privacy policy and terms of use, rendered with the guide layout. Plain statements of what the
 * code actually does; keep them in sync when data handling changes (retention: see api prune.ts).
 * Not legal advice: have a lawyer review before marketing the site.
 */
export const LEGAL_UPDATED = "November 20, 2026";

export interface LegalSite {
  /** Public contact address (build setting CONTACT_EMAIL). */
  contactEmail?: string;
}

function Contact({ site, children }: { site: LegalSite; children: ReactNode }) {
  return site.contactEmail
    ? <p>{children} <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.</p>
    : <p>{children} the contact address on this page (being set up).</p>;
}

export function PrivacyContent({ site }: { site: LegalSite }) {
  return (
    <article className="g-legal">
      <h1>Privacy policy</h1>
      <p className="g-updated">Last updated {LEGAL_UPDATED}</p>
      <p>
        Kanter Capital LLC operates Tripica. This page explains what Tripica collects, why, and how long it keeps it. Tripica does not sell
        personal information and does not use advertising cookies.
      </p>

      <h2>What Tripica collects</h2>
      <ul>
        <li><strong>Your searches.</strong> The places, dates, trip lengths, cabin and number of travelers you search for. Tripica sends them to its
          travel data providers to get prices, and caches the results so later searches are faster.</li>
        <li><strong>Your IP address.</strong> Used to apply daily search limits and the robot check, so one visitor can't use up the service.</li>
        <li><strong>A browser identifier.</strong> A random ID stored in your browser that links your saved trips, notes and price watches to this
          browser. It is not tied to your name or email.</li>
        <li><strong>Your account, if you create one.</strong> Accounts are optional. Clerk, our sign-in provider, handles your email address,
          name and sign-in (including Google sign-in). Tripica stores only your account ID, with your trips, watches and search counts, so they
          follow you across devices. When you first sign in on a browser, its saved trips and watches move to your account.</li>
        <li><strong>Fare observations.</strong> Prices seen in searches (route, dates, price), without anything that identifies you. They improve
          price predictions.</li>
        <li><strong>Booking-link clicks.</strong> A count by category (flight, stay, activity, car) and page type. No IP address or identifier is stored
          with it.</li>
      </ul>

      <h2>How long it's kept</h2>
      <ul>
        <li>Search-limit counters tied to an IP address are deleted after 31 days.</li>
        <li>Saved trips, notes and price watches are kept until you delete them in My trips.</li>
        <li>Your account stays until you delete it from the account menu; to also delete the trips and watches linked to it, write to us.</li>
        <li>Cached prices expire within days; fare observations are kept to improve predictions.</li>
        <li>The robot-check pass is stored only in your browser and expires at the end of the day (UTC).</li>
        <li>Cloudflare keeps request logs for a short period under its own policies.</li>
      </ul>

      <h2>Services Tripica uses</h2>
      <ul>
        <li><strong>Clerk</strong> provides accounts and sign-in, under its own privacy policy.</li>
        <li><strong>Cloudflare</strong> hosts the site and runs the robot check (Turnstile). See the{" "}
          <a href="https://www.cloudflare.com/turnstile-privacy-policy/">Cloudflare Turnstile Privacy Addendum</a>. When enabled, Cloudflare Web
          Analytics measures visits and page speed without cookies.</li>
        <li><strong>Travel data providers</strong> (such as SerpApi for Google Flights and Hotels results) receive your search details, not your
          identity.</li>
        <li><strong>Travelpayouts and booking partners.</strong> Affiliate links and Travelpayouts' script can tell a partner that you came from
          Tripica. When you book, the partner handles your visit and payment under its own privacy policy, and Tripica may earn a commission.</li>
      </ul>

      <h2>Sharing trips</h2>
      <p>
        A share link contains a copy of the plan and its notes. Anyone with the link can read that copy, including after you delete the original.
        Keep personal documents and payment details out of notes.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Delete saved trips and watches in My trips at any time.</li>
        <li>Clear your browser's site data to remove the browser identifier and robot-check pass.</li>
        <li>Ask for a copy or deletion of data linked to your browser identifier by writing to the address below.</li>
      </ul>
      <p>Tripica is not directed to children under 13.</p>

      <h2>Contact</h2>
      <Contact site={site}>Questions or requests: email</Contact>
    </article>
  );
}

export function TermsContent({ site }: { site: LegalSite }) {
  return (
    <article className="g-legal">
      <h1>Terms of use</h1>
      <p className="g-updated">Last updated {LEGAL_UPDATED}</p>
      <p>Kanter Capital LLC provides Tripica for travel research and planning. By using it you agree to these terms.</p>

      <h2>Prices and information</h2>
      <p>
        Fares and lodging prices change often. Cached prices, season ratings and price predictions are estimates, not quotes or guarantees. Confirm
        the itinerary, number of travelers, baggage, fees, entry requirements and final price with the provider before booking.
      </p>

      <h2>Bookings and payments</h2>
      <p>
        Tripica does not sell travel. You book and pay directly with the provider you choose, and its terms govern payment, changes, cancellations
        and refunds. Some links earn Tripica a commission at no extra cost to you.
      </p>

      <h2>Fair use</h2>
      <p>
        Live price searches are limited per visitor and protected by a robot check. Don't scrape the service, get around its limits or use it to
        resell prices.
      </p>

      <h2>Your plans</h2>
      <p>
        You choose what to save and share. Price watches recheck prices while Tripica is open and depend on available data and search limits;
        they may miss changes.
      </p>

      <h2>No warranty</h2>
      <p>
        Tripica is provided "as is", without warranties of any kind. To the extent the law allows, Kanter Capital LLC is not liable for losses
        arising from use of the service, including price changes, unavailable fares or provider errors.
      </p>

      <h2>Changes and contact</h2>
      <p>These terms may change; the date above shows the latest version.</p>
      <Contact site={site}>Questions: email</Contact>
    </article>
  );
}
