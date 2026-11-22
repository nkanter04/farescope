/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { MONTH_NAMES } from "@farescope/shared";
import { cellLabel, cheapestCell, gridCells, gridMonths, shade } from "./home-grid.ts";
import { homeScenes, type HomeScene } from "./home-scenes.ts";

/**
 * The marketing homepage ("/"), rendered at build time like the guides. The app itself lives at
 * /app/. Keep claims true for both builds: `live` is the Cloudflare build with real prices; the
 * GitHub Pages demo uses simulated prices and says so. No prices appear here: the globe, grid and
 * counter are illustrations (labelled as such). Their trip counts are computed from the real place
 * data in home-scenes.ts. home.ts (bundled to /home.js) animates the static markup rendered here.
 */
export interface LandingSite {
  today: string;
  /** Real-price build (Cloudflare) vs the simulated demo. */
  live?: boolean;
  /** Where the live site is, for the demo's "use real prices" link. */
  liveUrl?: string;
  /** The bundled animation script ("home.js?v=…"); without it the page stays static. */
  homeScript?: string;
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

const fmt = (n: number) => n.toLocaleString("en-US");

/** Hero globe: a canvas the script draws on, with a caption naming the example search. */
function GlobeArt({ scenes }: { scenes: HomeScene[] }) {
  return (
    <figure className="h-globe-wrap">
      <canvas className="h-globe" data-globe aria-label="Illustration: flights fanning out from one city to many destinations, with the cheaper routes highlighted" role="img" />
      <figcaption className="h-caption">
        <span className="h-caption-text"><strong data-route>{scenes[0].route}</strong> <span data-when>{scenes[0].when}</span></span>
        <span className="h-key"><span className="h-line cheap" /> cheaper <span className="h-line" /> other options · Illustration</span>
        <span className="h-dots" role="group" aria-label="Example searches">
          {scenes.map((s, i) => <button key={s.route} type="button" data-scene={i} aria-pressed={i === 0} aria-label={s.route} />)}
        </span>
      </figcaption>
    </figure>
  );
}

/** "The search, happening": the example search's grid of every day × trip length, rendered finished. */
function SweepArt({ scene }: { scene: HomeScene }) {
  const cells = gridCells(scene, 1);
  const best = cheapestCell(cells);
  const nights = scene.maxNights - scene.minNights + 1;
  const days = cells.length / nights;
  const [fromName, toName] = scene.route.split(" → ");
  const [when, stay] = scene.when.split(" · ");
  return (
    <div className="h-sweep" data-sweep>
      <div className="h-searchbar" aria-label="Example search">
        <span><small>From</small><b data-field-from>{fromName}</b></span>
        <span><small>To</small><b data-field-to>{toName}</b></span>
        <span><small>Leaving</small><b data-field-when>{when}</b></span>
        <span><small>Stay</small><b data-field-stay>{stay}</b></span>
      </div>
      <div className="h-sweep-body">
        <div className="h-grid-wrap">
          <div className="h-grid-head">
            <span>Every departure day <span className="g-muted">×</span> every trip length</span>
            <span className="h-key"><span className="h-sw c0" /> cheaper <span className="h-sw c4" /> pricier · Illustration</span>
          </div>
          <div className="h-grid done" data-grid>
            {gridMonths(scene).map((m) => (
              <div className="h-month" key={m.label}>
                <span className="h-month-name">{m.label}</span>
                <div className="h-cells" style={{ "--cols": m.days, "--rows": nights } as CSSProperties}>
                  {Array.from({ length: nights }, (_, n) => Array.from({ length: m.days }, (_, d) => {
                    const c = cells[n * days + m.offset + d];
                    return <i key={`${n}-${d}`} className={`c${shade(c.level)} on${c === best ? " best" : ""}`} />;
                  }))}
                </div>
              </div>
            ))}
          </div>
          <p className="h-pin show" data-pin>Cheapest: {cellLabel(scene, best)}</p>
        </div>
        <div className="h-compare">
          <div className="h-compare-one">
            <span className="h-one-dot" aria-hidden="true" />
            <strong>1</strong>
            <span>trip a regular flight search checks</span>
          </div>
          <div className="h-compare-many">
            <canvas className="h-field" data-field aria-hidden="true" />
            <strong data-count>{fmt(scene.trips)}{scene.capped ? "+" : ""}</strong>
            <span>trips this one search compares</span>
            <small className="g-muted" data-formula>{fmt(scene.airports)} airport {scene.airports === 1 ? "pair" : "pairs"} × every day × {nights} trip lengths</small>
            <small className="g-muted" data-field-note />
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "🗺️", title: "Places, not airports", text: "A city, a country, a region or anywhere." },
  { icon: "📅", title: "Every date at once", text: "A window of days and a range of nights." },
  { icon: "🧳", title: "Multi-stop trips", text: "Several cities; the cheapest dates and order." },
  { icon: "☀️", title: "When to visit", text: "Weather, holidays and crowds by month." },
];

export function LandingContent({ site }: { site: LandingSite }) {
  const scenes = homeScenes(site.today);
  const examples = [
    { label: "Japan in March", href: search("country:JP", upcoming(3, site.today)) },
    { label: "Europe this summer", href: search("region:Europe", upcoming(6, site.today)) },
    { label: "Caribbean in February", href: search("region:Central America & Caribbean", upcoming(2, site.today)) },
    { label: `Hawaii in ${MONTH_NAMES[9]}`, href: search("state:US-HI", upcoming(10, site.today)) },
  ];
  return (
    <div className="l-page">
      <section className="l-hero h-hero">
        <div className="l-hero-text">
          <p className="l-kicker">Flexible trip search</p>
          <h1>Anywhere. Any day. <span className="h-accent">Cheapest first.</span></h1>
          <p className="g-lead">One search checks every place, date and trip length, then shows where and when your trip costs least.</p>
          <div className="l-ctas">
            <a className="g-cta l-cta-big" href="app/">Start searching</a>
            <a className="l-cta-ghost" href="guides/">When to visit</a>
          </div>
          <p className="l-try">Try: {examples.map((e, i) => (
            <span key={e.href}>{i > 0 && " · "}<a href={e.href}>{e.label}</a></span>
          ))}</p>
          {site.live
            ? <p className="g-muted">Live prices from Google Flights. Free during early access.</p>
            : <p className="g-muted">This demo uses simulated prices.{site.liveUrl && <> <a href={site.liveUrl}>Use Tripica with real prices →</a></>}</p>}
        </div>
        <GlobeArt scenes={scenes} />
      </section>

      <section className="l-section" aria-labelledby="h-every">
        <h2 id="h-every">You give a range. We check every trip in it.</h2>
        <SweepArt scene={scenes[0]} />
      </section>

      <section className="l-section" aria-labelledby="l-features">
        <h2 id="l-features" className="g-visually-hidden">Features</h2>
        <ul className="l-features h-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="l-icon" aria-hidden="true">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="l-section l-note h-note" aria-labelledby="l-pricing">
        <div>
          <h2 id="l-pricing">Free during early access</h2>
          <p>You book directly with the airline or travel site. Some links earn us a commission at no cost to you.</p>
        </div>
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

      <script type="application/json" id="home-scenes" dangerouslySetInnerHTML={{ __html: JSON.stringify(scenes).replace(/</g, "\\u003c") }} />
      {site.homeScript && <script defer src={site.homeScript} />}
    </div>
  );
}
