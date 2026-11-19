/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { ReactNode } from "react";
import { Logo } from "../components/Logo.tsx";
import {
  COUNTRIES,
  MONTH_NAMES,
  MONTH_SHORT,
  cToF,
  mmToIn,
  monthRanges,
  tempText,
  bookingLinks,
  type BookingKind,
  type DestinationGuide,
  type MonthGuide,
  type PartnerTemplate,
} from "@farescope/shared";

/** Travelpayouts Drive script, required on every page by the affiliate program. */
export const TP_DRIVE_SRC = "https://emrldco.com/NjAzODE1.js?t=603815";

/**
 * Static "When to visit" pages, rendered at build time to plain HTML (no client JavaScript), so
 * search engines can index them. Links are relative so the site works under any base path.
 */

export interface SiteConfig {
  /** Absolute URL of the site root (no trailing slash), for canonical links and the sitemap. */
  siteUrl: string;
  /** Build date (YYYY-MM-DD), for "next April" links into the app and sitemap dates. */
  today: string;
  /** Short hash of guides.css, so browsers fetch the new stylesheet after each deploy. */
  cssVersion?: string;
  /** Partner (affiliate) link templates; empty = plain public search links. */
  partners?: PartnerTemplate[];
  measure?: boolean;
  analyticsToken?: string;
}

export const monthSlug = (m: number) => MONTH_NAMES[m - 1].toLowerCase();
const regionOf = (cc: string) => COUNTRIES[cc]?.region ?? "Other";
const countryName = (cc: string) => COUNTRIES[cc]?.name ?? cc;

/** First day of the next occurrence of a month on or after today, as YYYY-MM. */
export function nextMonth(m: number, today: string): string {
  const y = Number(today.slice(0, 4));
  const cur = Number(today.slice(5, 7));
  return `${m >= cur ? y : y + 1}-${String(m).padStart(2, "0")}`;
}

/** Deep link into the app that pre-fills and runs a search (see store.ts readUrlSearch). */
export function appLink(root: string, searchTo: string, month?: string): string {
  const q = new URLSearchParams({ to: searchTo });
  if (month) q.set("depart", month);
  return `${root}?${q}`;
}

function Layout(props: { title: string; description: string; path: string; root: string; site: SiteConfig; jsonLd?: object; children: ReactNode }) {
  const canonical = `${props.site.siteUrl}/${props.path}`;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        {/* Travelpayouts Drive (affiliate link conversion; partner 603815) */}
        <script async data-cmp-ab="2" src={TP_DRIVE_SRC} />
        {props.site.measure && <script defer src={props.root + "measurement.js"} data-token={props.site.analyticsToken} />}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="Tripica" />
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={props.description} />
        <meta property="og:url" content={canonical} />
        <link rel="icon" type="image/svg+xml" href={`${props.root}favicon.svg`} />
        <meta property="og:image" content={`${props.site.siteUrl}/logo.svg`} />
        <link rel="stylesheet" href={`${props.root}guides/guides.css${props.site.cssVersion ? `?v=${props.site.cssVersion}` : ""}`} />
        {props.jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(props.jsonLd).replace(/</g, "\\u003c") }} />}
      </head>
      <body>
        <header className="g-top">
          <a className="g-brand" href={props.root}>
            <Logo size={32} />Tripica
          </a>
          <nav>
            <a href={`${props.root}guides/`}>Guides</a>
            <a href={props.root}>Search flights</a>
          </nav>
        </header>
        <main className="g-main">{props.children}</main>
        <footer className="g-foot">
          <p>
            Climate: <a href="https://power.larc.nasa.gov/">NASA POWER</a> monthly averages (2001–2025) for the surrounding ~50 km area; city-center
            temperatures can differ by a few degrees. Public holidays: <a href="https://date.nager.at/">Nager.Date</a>. Seasonal events and the
            demand estimates are Tripica's own. Prices depend on dates and availability; nothing here is a price quote.
          </p>
          <p><a href={props.root + "privacy/"}>Privacy</a> · <a href={props.root + "terms/"}>Terms</a></p>
          <p>Tripica is operated by Kanter Capital LLC.</p>
        </footer>
      </body>
    </html>
  );
}

const LABEL_CLASS: Record<MonthGuide["label"], string> = {
  "Best value": "best",
  "Peak season": "peak",
  "Shoulder season": "shoulder",
  "Off-season": "off",
};

/** Highs/lows band and monthly rain bars, drawn as static SVG. */
function ClimateChart({ guide }: { guide: DestinationGuide }) {
  const W = 720, H = 260, L = 44, R = 70, T = 20, B = 40;
  const months = guide.months.map((m) => m.climate);
  const highs = months.map((c) => cToF(c.highC));
  const lows = months.map((c) => cToF(c.lowC));
  const tMin = Math.floor((Math.min(...lows) - 5) / 10) * 10;
  const tMax = Math.ceil((Math.max(...highs) + 5) / 10) * 10;
  const rMax = Math.max(50, Math.ceil(Math.max(...months.map((c) => c.rainMm)) / 50) * 50);
  const step = (W - L - R) / 12;
  const x = (i: number) => L + step * (i + 0.5);
  const yT = (f: number) => T + (1 - (f - tMin) / (tMax - tMin)) * (H - T - B);
  const yR = (mm: number) => H - B - (mm / rMax) * (H - T - B) * 0.55;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yT(v).toFixed(1)}`).join(" ");
  const band = `${line(highs)} ${lows.map((_, i) => `L${x(11 - i).toFixed(1)},${yT(lows[11 - i]).toFixed(1)}`).join(" ")} Z`;
  const ticks = [tMin, Math.round((tMin + tMax) / 2), tMax];
  return (
    <figure className="g-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${guide.destination.name}: average highs from ${Math.min(...highs)} to ${Math.max(...highs)}°F; rainiest month ${MONTH_NAMES[months.reduce((b, c, i) => (c.rainMm > months[b].rainMm ? i : b), 0)]}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={L} x2={W - R} y1={yT(t)} y2={yT(t)} />
            <text className="axis" x={L - 8} y={yT(t) + 4} textAnchor="end">{t}°</text>
          </g>
        ))}
        {months.map((c, i) => (
          <rect key={i} className={`rain ${guide.best.includes(i + 1) ? "rain-best" : ""}`} x={x(i) - step * 0.28} width={step * 0.56} y={yR(c.rainMm)} height={H - B - yR(c.rainMm)} rx="3" />
        ))}
        <path className="band" d={band} />
        <path className="high" d={line(highs)} />
        <path className="low" d={line(lows)} />
        {highs.map((h, i) => <circle key={i} className="dot" cx={x(i)} cy={yT(h)} r="3" />)}
        {MONTH_SHORT.map((m, i) => (
          <text key={m} className={`axis ${guide.best.includes(i + 1) ? "axis-best" : ""}`} x={x(i)} y={H - 16} textAnchor="middle">{m}</text>
        ))}
        <text className="axis" x={W - R + 8} y={yR(rMax) + 4}>{rMax} mm</text>
        <text className="axis" x={W - R + 8} y={H - B + 4}>0</text>
      </svg>
      <figcaption>
        <span className="key key-band" /> Average high and low (°F) <span className="key key-rain" /> Rain per month (mm) · best-value months highlighted
      </figcaption>
    </figure>
  );
}

export function DestinationPage({ guide, site }: { guide: DestinationGuide; site: SiteConfig }) {
  const d = guide.destination;
  const root = "../../";
  const best = guide.best.map((m) => MONTH_NAMES[m - 1]);
  const title = `Best time to visit ${d.name}: weather, crowds and cheaper months`;
  const description = `${guide.summary} Month-by-month weather, holidays and crowd levels for ${d.name}, ${countryName(d.country)}.`;
  return (
    <Layout
      title={title}
      description={description}
      path={`guides/${d.slug}/`}
      root={root}
      site={site}
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        dateModified: site.today,
        publisher: { "@type": "Organization", name: "Tripica (Kanter Capital LLC)" },
        about: { "@type": "TouristDestination", name: d.name, geo: { "@type": "GeoCoordinates", latitude: d.lat, longitude: d.lng } },
      }}
    >
      <nav className="g-crumbs"><a href={`${root}guides/`}>Guides</a> › {regionOf(d.country)} › {d.name}</nav>
      <h1>When to visit {d.name}</h1>
      <p className="g-lead">{guide.summary}</p>
      <div className="g-best">
        {guide.best.map((m) => (
          <a key={m} className="g-cta" href={appLink(root, d.searchTo, nextMonth(m, site.today))}>
            Find cheap trips in {MONTH_NAMES[m - 1]} →
          </a>
        ))}
      </div>
      {d.via && <p className="g-muted">Flights search {d.via}.</p>}

      <ClimateChart guide={guide} />

      <h2>{d.name} month by month</h2>
      <div className="g-table-wrap">
        <table className="g-table">
          <thead>
            <tr><th>Month</th><th>Season</th><th>High / low</th><th>Rain</th><th>What to expect</th></tr>
          </thead>
          <tbody>
            {guide.months.map((m) => (
              <tr key={m.month} id={monthSlug(m.month)}>
                <th scope="row">
                  <a href={appLink(root, d.searchTo, nextMonth(m.month, site.today))} title={`Search ${MONTH_NAMES[m.month - 1]} trips`}>{MONTH_NAMES[m.month - 1]}</a>
                </th>
                <td><span className={`g-pill ${LABEL_CLASS[m.label]}`}>{m.label}</span></td>
                <td className="num">{cToF(m.climate.highC)}° / {cToF(m.climate.lowC)}°F<br /><span className="g-muted">{Math.round(m.climate.highC)}° / {Math.round(m.climate.lowC)}°C</span></td>
                <td className="num">{m.climate.rainMm} mm<br /><span className="g-muted">{mmToIn(m.climate.rainMm)} in</span></td>
                <td><ul>{m.notes.slice(1).map((n, i) => <li key={i}>{n}</li>)}</ul></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!guide.holidayData && <p className="g-muted">Public-holiday data for {countryName(d.country)} isn't available yet, so local holidays aren't counted in the crowd estimates.</p>}
      <p className="g-muted">
        "Best value" = pleasant weather with lower demand; "Peak season" = pleasant and busy (local holidays, famous events, US school breaks). Best
        months for {d.name}: {best.join(", ") || "none stand out"}.
      </p>
      <p><a className="g-cta" href={appLink(root, d.searchTo)}>Search all dates to {d.name} →</a></p>
      <PlanLinks name={d.name} country={countryName(d.country)} site={site} />
    </Layout>
  );
}

const PLAN: { kind: BookingKind; label: string }[] = [
  { kind: "stay", label: "Hotels" },
  { kind: "hostel", label: "Hostels" },
  { kind: "activity", label: "Things to do" },
  { kind: "car", label: "Car rental" },
];

/** Where to book the rest of the trip. Partner links carry affiliate IDs, so the disclosure shows with them. */
function PlanLinks({ name, country, site }: { name: string; country: string; site: SiteConfig }) {
  const rows = PLAN.map((p) => ({ ...p, links: bookingLinks(p.kind, { city: name, country }, site.partners ?? []) })).filter((r) => r.links.length);
  if (!rows.length) return null;
  return (
    <section className="g-plan">
      <h2>Plan the rest of your {name} trip</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.kind}>
            <strong>{r.label}</strong>
            {r.links.map((l) => <a data-booking-kind={r.kind} key={l.url} href={l.url} rel="noreferrer sponsored" target="_blank">{l.partner} ↗</a>)}
          </li>
        ))}
      </ul>
      {rows.some((r) => r.links.some((l) => l.affiliate)) && <p className="g-muted">Tripica may earn a commission if you book through these links.</p>}
    </section>
  );
}

export function MonthPage({ month, guides, site }: { month: number; guides: DestinationGuide[]; site: SiteConfig }) {
  const root = "../../../";
  const name = MONTH_NAMES[month - 1];
  const ranked = guides
    .map((g) => ({ g, m: g.months[month - 1] }))
    .filter(({ m }) => m.comfort >= 0.45)
    .sort((a, b) => b.m.value - a.m.value);
  const title = `Where to go in ${name}: best-value destinations`;
  const description = `${ranked.length} destinations with good weather in ${name}, ranked by value: pleasant weather without the peak-season crowds.`;
  return (
    <Layout title={title} description={description} path={`guides/month/${monthSlug(month)}/`} root={root} site={site}
      jsonLd={{ "@context": "https://schema.org", "@type": "Article", headline: title, description, dateModified: site.today }}>
      <nav className="g-crumbs"><a href={`${root}guides/`}>Guides</a> › {name}</nav>
      <h1>Where to go in {name}</h1>
      <p className="g-lead">Destinations with good weather in {name}, best value first. Peak-season picks are pleasant but busier and usually pricier.</p>
      <MonthNav current={month} root={root} />
      <ol className="g-rank">
        {ranked.map(({ g, m }) => (
          <li key={g.destination.slug}>
            <div className="g-rank-head">
              <a href={`${root}guides/${g.destination.slug}/#${monthSlug(month)}`}><strong>{g.destination.name}</strong></a>
              <span className="g-muted">{countryName(g.destination.country)}</span>
              <span className={`g-pill ${LABEL_CLASS[m.label]}`}>{m.label}</span>
            </div>
            <p>{tempText(m.climate.highC)} highs · {m.climate.rainMm} mm rain{detailNote(m) ? ` · ${detailNote(m)}` : ""}</p>
            <a className="g-link" href={appLink(root, g.destination.searchTo, nextMonth(month, site.today))}>Find {name} trips →</a>
          </li>
        ))}
      </ol>
    </Layout>
  );
}

/** The most specific note for a month (rain, holidays, events), skipping the generic label sentence. */
function detailNote(m: MonthGuide): string | undefined {
  return m.notes.slice(1).find((n) => !/usually means|don't expect/.test(n));
}

function MonthNav({ current, root }: { current?: number; root: string }) {
  return (
    <nav className="g-months" aria-label="Browse by month">
      {MONTH_NAMES.map((n, i) => (
        <a key={n} className={current === i + 1 ? "on" : ""} href={`${root}guides/month/${monthSlug(i + 1)}/`}>{MONTH_SHORT[i]}</a>
      ))}
    </nav>
  );
}

export function IndexPage({ guides, site }: { guides: DestinationGuide[]; site: SiteConfig }) {
  const root = "../";
  const byRegion = new Map<string, DestinationGuide[]>();
  for (const g of guides) {
    const r = regionOf(g.destination.country);
    byRegion.set(r, [...(byRegion.get(r) ?? []), g]);
  }
  const title = "When to visit: travel guides by destination and month";
  const description = `When to go to ${guides.length} destinations: month-by-month weather, holidays, crowds and the best-value months.`;
  return (
    <Layout title={title} description={description} path="guides/" root={root} site={site}>
      <h1>When to visit</h1>
      <p className="g-lead">Pick a destination for its best-value months, or a month to see where the weather is good and the crowds are thinner.</p>
      <h2>Browse by month</h2>
      <MonthNav root={root} />
      {[...byRegion.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([region, list]) => (
        <section key={region}>
          <h2>{region}</h2>
          <ul className="g-cards">
            {list.sort((a, b) => a.destination.name.localeCompare(b.destination.name)).map((g) => (
              <li key={g.destination.slug}>
                <a href={`${root}guides/${g.destination.slug}/`}>
                  <strong>{g.destination.name}</strong>
                  <span className="g-muted">{countryName(g.destination.country)}</span>
                  <span>Best value: {monthRanges(g.best) || "varies"}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Layout>
  );
}
