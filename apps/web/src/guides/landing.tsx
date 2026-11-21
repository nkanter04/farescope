/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { MONTH_NAMES } from "@farescope/shared";

/**
 * The marketing homepage ("/"), rendered at build time like the guides. The app itself lives at
 * /app/. Keep claims true for both builds: `live` is the Cloudflare build with real prices; the
 * GitHub Pages demo uses simulated prices and says so. No prices appear here (the calendar is an
 * unpriced illustration), so nothing can be mistaken for a quote.
 */
export interface LandingSite {
  today: string;
  /** Real-price build (Cloudflare) vs the simulated demo. */
  live?: boolean;
  /** Where the live site is, for the demo's "use real prices" link. */
  liveUrl?: string;
}

/** YYYY-MM of the next occurrence of month m (1..12) at least `ahead` months from today. */
function upcoming(m: number, today: string, ahead = 1): string {
  const y = Number(today.slice(0, 4));
  const cur = Number(today.slice(5, 7));
  const year = m >= cur + ahead ? y : y + 1;
  return `${year}-${String(m).padStart(2, "0")}`;
}

const search = (to: string, month?: string) => {
  const q = new URLSearchParams({ to });
  if (month) q.set("depart", month);
  return `app/?${q}`;
};

/** Unpriced calendar illustration: tints only (cheaper = greener), not real fares. */
function CalendarArt() {
  // A fixed pattern, so the build is deterministic.
  const levels = [3, 2, 2, 1, 0, 1, 2, 3, 4, 3, 1, 0, 0, 1, 2, 2, 3, 4, 4, 3, 2, 1, 1, 0, 1, 2, 3, 3];
  return (
    <figure className="l-art" aria-label="Illustration of Tripica's price calendar">
      <div className="l-art-search">
        <span><small>From</small>Austin</span>
        <span><small>To</small>Anywhere in Japan</span>
        <span><small>Leaving</small>Any day, Jan–Apr</span>
        <span><small>Stay</small>7–12 nights</span>
      </div>
      <div className="l-art-cal">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <b key={`h${i}`}>{d}</b>)}
        {levels.map((l, i) => <i key={i} className={`t${l}`}>{i + 1}</i>)}
      </div>
      <figcaption>
        <span className="l-swatch t0" /> cheaper <span className="l-swatch t4" /> pricier · Illustration
      </figcaption>
    </figure>
  );
}

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "🗺️", title: "Search places, not just airports", text: "A city, a US state, a whole country, a region or anywhere. Tripica checks every airport that counts." },
  { icon: "📅", title: "Every date at once", text: "Give it a window and a range of trip lengths. A price calendar shows the cheapest day to leave for each." },
  { icon: "🌍", title: "Globe and map views", text: "See where your money goes furthest, with the cheapest fares to each destination on a 3D globe." },
  { icon: "🧭", title: "Explore by month", text: "Not sure where to go? Pick a month and see the cheapest places to fly from your home airport." },
  { icon: "☀️", title: "When to visit", text: "Weather, holidays and crowd seasons for popular destinations, so a cheap month is also a good one." },
  { icon: "🧳", title: "Plan the whole trip", text: "List several cities and how many nights in each. Tripica finds the cheapest start date, nights and order, then you add stays, compare trips and share plans." },
];

export function LandingContent({ site }: { site: LandingSite }) {
  const examples = [
    { label: "Anywhere in Japan in March", href: search("country:JP", upcoming(3, site.today)) },
    { label: "Europe this summer", href: search("region:Europe", upcoming(6, site.today)) },
    { label: "Caribbean in February", href: search("region:Central America & Caribbean", upcoming(2, site.today)) },
    { label: `Hawaii in ${MONTH_NAMES[9]}`, href: search("state:US-HI", upcoming(10, site.today)) },
  ];
  return (
    <div className="l-page">
      <section className="l-hero">
        <div className="l-hero-text">
          <p className="l-kicker">Flexible trip search</p>
          <h1>Find the cheapest time to take the whole trip.</h1>
          <p className="g-lead">
            Search whole countries, months and trip lengths at once. Tripica checks every date for you and shows when and where your trip
            costs least, then helps you plan the stays.
          </p>
          <div className="l-ctas">
            <a className="g-cta l-cta-big" href="app/">Start searching</a>
            <a className="l-cta-ghost" href="guides/">When to visit guides</a>
          </div>
          <p className="l-try">Try: {examples.map((e, i) => (
            <span key={e.href}>{i > 0 && " · "}<a href={e.href}>{e.label}</a></span>
          ))}</p>
          {site.live
            ? <p className="g-muted">Live prices from Google Flights. Free during early access.</p>
            : <p className="g-muted">This demo uses simulated prices.{site.liveUrl && <> <a href={site.liveUrl}>Use Tripica with real prices →</a></>}</p>}
        </div>
        <CalendarArt />
      </section>

      <section className="l-section" aria-labelledby="l-features">
        <h2 id="l-features">One search, every option</h2>
        <ul className="l-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="l-icon" aria-hidden="true">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="l-section" aria-labelledby="l-how">
        <h2 id="l-how">How it works</h2>
        <ol className="l-steps">
          <li><strong>Describe the trip loosely.</strong> “Austin to anywhere in Japan, leaving any day from January to April, for 7 to 12 nights.”</li>
          <li><strong>See every option.</strong> Prices fill a calendar, a list and a globe as they arrive, cheapest first.</li>
          <li><strong>Pick, plan and book.</strong> Open a flight to see the details, add stays and book directly with the airline, hotel or travel site.</li>
        </ol>
      </section>

      <section className="l-section l-note" aria-labelledby="l-pricing">
        <h2 id="l-pricing">Free during early access</h2>
        <p>
          Tripica is free while it's new. Live price searches are limited per visitor each day so the service stays fast for everyone, and
          results you've already seen are always free to revisit. Tripica doesn't sell tickets: you book with the provider you choose, and
          some booking links earn Tripica a commission at no extra cost to you.
        </p>
        <a className="g-cta" href="app/">Open Tripica</a>
      </section>

      <section className="l-section" aria-labelledby="l-faq">
        <h2 id="l-faq">Questions</h2>
        <details><summary>Where do the prices come from?</summary>
          <p>{site.live
            ? "Live searches use Google Flights results through a data provider, plus a cache of recent searches. Prices change often, so the airline or travel site has the final price."
            : "This demo makes up realistic prices so you can try every feature. The live site uses real Google Flights results."}</p></details>
        <details><summary>Can I book on Tripica?</summary>
          <p>No. Tripica finds the dates and places, then links you to the airline, hotel or travel site to book and pay.</p></details>
        <details><summary>Why are live searches limited?</summary>
          <p>Every live search costs us real money with our data provider. Limits keep Tripica free for everyone; cached prices don't count.</p></details>
        <details><summary>Do I need an account?</summary>
          <p>No. Your saved trips and price watches are linked to this browser. See the <a href="privacy/">privacy policy</a> for details.</p></details>
      </section>
    </div>
  );
}
