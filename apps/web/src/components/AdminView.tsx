import { useEffect, useState } from "react";
import type { Count, DailyPoint, DashboardStats } from "../../../api/src/analytics.ts";
import { fetchAdminStats } from "../api.ts";

/**
 * Owner-only analytics dashboard (open /app/?admin). The numbers come from GET /api/admin/stats,
 * which only answers for accounts in ADMIN_USER_IDS. One series per chart, in the accent color;
 * every bar shows its exact value on hover, and the ranked lists double as tables.
 */
const RANGES = [7, 30, 90, 365] as const;
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const minutes = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const countryName = (() => {
  try { const names = new Intl.DisplayNames(["en"], { type: "region" }); return (c: string) => names.of(c) ?? c; } catch { return (c: string) => c; }
})();
const LABELS: Record<string, string> = {
  search_run: "Searches run", fare_open: "Flights opened", trip_save: "Trips saved", plan_run: "Trip plans run",
  booking_click: "Booking clicks", install_click: "Install clicks", visitor: "Visitors (no account)", account: "Accounts",
  daily: "Visitor daily limit", monthly: "Site-wide monthly budget", google: "Google search", reddit: "Reddit", tiktok: "TikTok",
  instagram: "Instagram", youtube: "YouTube", friend: "A friend", other: "Somewhere else", skip: "Prefer not to say",
  desktop: "Desktop", mobile: "Phone", tablet: "Tablet", "(none)": "Unknown", alerts_on: "Alerts turned on",
  search: "After a search", save: "After saving", trips: "My trips", limit: "At the search limit", header: "Header button",
  homepage: "Homepage", "limit-signin": "At the limit (sign in)", "search-signin": "After a search (sign in)", "save-signin": "After saving (sign in)",
  "trips-signin": "My trips (sign in)", "alerts-watch": "Alerts (flight)", "alerts-trips": "Alerts (My trips)", alerts: "Price alerts",
};
const label = (k: string) => LABELS[k] ?? k;
/** "/app/#plan" → "App: Plan a trip", "/guides/kyoto/" → "Guide: kyoto". */
const pageName = (p: string) => {
  const app: Record<string, string> = { "/app/": "App: Search", "/app/#plan": "App: Plan a trip", "/app/#trips": "App: My trips" };
  if (app[p]) return app[p];
  if (p === "/") return "Homepage";
  const guide = /^\/guides\/(?:month\/)?([^/]+)\/$/.exec(p);
  if (p === "/guides/") return "Guides index";
  return guide ? `Guide: ${guide[1].replace(/-/g, " ")}` : p;
};

export function AdminView() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [state, setState] = useState<Awaited<ReturnType<typeof fetchAdminStats>> | "loading">("loading");
  useEffect(() => {
    let live = true;
    setState("loading");
    void fetchAdminStats(days).then((r) => { if (live) setState(r); });
    return () => { live = false; };
  }, [days]);

  return <section className="admin">
    <header className="admin-head">
      <div>
        <h1>Analytics</h1>
        {state !== "loading" && state.stats && <p className="muted small">
          {shortDay(state.stats.range.from)} – {shortDay(state.stats.range.to)} · counting since {shortDay(state.stats.countingSince)} · first-party, no cookies
        </p>}
      </div>
      <div className="seg admin-range" role="group" aria-label="Date range">
        {RANGES.map((d) => <button key={d} className={d === days ? "on" : ""} aria-pressed={d === days} onClick={() => setDays(d)}>{d === 365 ? "12 months" : `${d} days`}</button>)}
      </div>
    </header>
    {state === "loading" ? <p role="status" className="muted"><span className="spinner" aria-hidden /> Loading…</p>
      : state.stats ? <Dashboard s={state.stats} />
      : <div className="card admin-blocked">
        <p>{state.signIn ? "Sign in with the owner account to see analytics." : state.error}</p>
        {state.forbiddenUser && <p className="muted small">Signed in as <code>{state.forbiddenUser}</code>. Add this ID to <code>ADMIN_USER_IDS</code> to allow it.</p>}
      </div>}
  </section>;
}

function Dashboard({ s }: { s: DashboardStats }) {
  const t = s.totals;
  const credits = s.credits.reduce((sum, c) => sum + c.n, 0);
  return <>
    <div className="admin-tiles">
      <Tile label="Visitors" value={fmt(t.visitors)} note={`${fmt(t.returningVisitors)} came back on another day`} />
      <Tile label="Visits" value={fmt(t.sessions)} note={`${fmt(t.pageViews)} pages viewed`} />
      <Tile label="Time per visit" value={minutes(t.avgEngagedMs)} note={`median ${minutes(t.medianEngagedMs)}, while the page is visible`} />
      <Tile label="Sign-ups" value={fmt(t.signups)} note={`${fmt(t.accounts)} accounts in total`} />
      <Tile label="Credits used" value={fmt(credits)} note={s.credits.map((c) => `${fmt(c.n)} ${c.key === "account" ? "by accounts" : c.key === "alerts" ? "by alerts" : "by visitors"}`).join(" · ") || "none yet"} />
      {s.alerts && <Tile label="Price alerts" value={fmt(s.alerts.devices)} note={`devices with alerts on · ${fmt(s.alerts.sent)} alerts sent`} />}
    </div>

    <div className="admin-grid">
      <Panel title="Visitors per day"><Bars points={s.daily} pick={(p) => p.visitors} unit="visitors" /></Panel>
      <Panel title="Sign-ups per day"><Bars points={s.daily} pick={(p) => p.signups} unit="sign-ups" /></Panel>
      <Panel title="Credits used per day"><Bars points={s.daily} pick={(p) => p.credits} unit="credits" /></Panel>
      <Panel title="Sign-ups per month (all time)">
        {s.monthlySignups.length ? <Ranked items={s.monthlySignups.map((m) => ({ key: new Date(`${m.key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }), n: m.n }))} /> : <Empty />}
      </Panel>
    </div>

    <Panel title="Sign-up funnel" wide note="Visits that reached each step. The drop between two steps shows where people back out.">
      <ol className="admin-funnel">
        {s.funnel.map((f, i) => <li key={f.step}>
          <span className="admin-funnel-label">{f.step}</span>
          <span className="admin-bar-track"><span className="admin-bar" style={{ width: pct(f.sessions, s.funnel[0].sessions) === "–" ? "0%" : pct(f.sessions, s.funnel[0].sessions) }} title={`${f.step}: ${fmt(f.sessions)} visits`} /></span>
          <span className="admin-num">{fmt(f.sessions)} <small className="muted">{i === 0 ? "" : `${pct(f.sessions, s.funnel[i - 1].sessions)} of previous`}</small></span>
        </li>)}
      </ol>
    </Panel>

    <div className="admin-grid">
      <Panel title="Where visitors come from" note="Visits per referring site."><Ranked items={s.referrers} /></Panel>
      <Panel title="Campaign tags" note="Links tagged ?utm_source=… (for example ?utm_source=reddit)."><Ranked items={s.campaigns} /></Panel>
      <Panel title="Countries" note="Where visitors are (from their connection), not their nationality."><Ranked items={s.countries.map((c) => ({ ...c, key: c.key === "(none)" ? c.key : countryName(c.key) }))} /></Panel>
      <Panel title="Devices"><Ranked items={s.devices} /></Panel>
      <Panel title="Most viewed pages"><Ranked items={s.pages.map((p) => ({ ...p, key: pageName(p.key) }))} /></Panel>
      <Panel title="What people do"><Ranked items={s.actions} /></Panel>
      <Panel title="Booking clicks by partner"><Ranked items={s.bookingClicks.map((b) => ({ ...b, key: b.key.replace(":", " · ") }))} /></Panel>
      <Panel title="Search limits reached"><Ranked items={s.limitHits} /></Panel>
      <Panel title="Sign-up suggestions shown" note="Visits that saw a suggestion, by place."><Ranked items={s.nudges.shown} /></Panel>
      <Panel title="Sign-up windows opened" note="Visits that opened sign-up, by the button they used."><Ranked items={s.nudges.opened} /></Panel>
      <Panel title="How they heard about Tripica" note={`From the optional sign-up question (${fmt(s.survey.answers)} answers, all time).`}><Ranked items={s.survey.heard} /></Panel>
      <Panel title="Age range" note="From the optional sign-up question, all time."><Ranked items={s.survey.age} /></Panel>
    </div>
  </>;
}

function Tile({ label: name, value, note }: { label: string; value: string; note: string }) {
  return <div className="card admin-tile"><span className="muted small">{name}</span><strong>{value}</strong><span className="muted small">{note}</span></div>;
}

function Panel({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: React.ReactNode }) {
  return <section className={`card admin-panel${wide ? " wide" : ""}`} aria-label={title}>
    <h2>{title}</h2>
    {note && <p className="muted small">{note}</p>}
    {children}
  </section>;
}

const Empty = () => <p className="muted small admin-empty">No data yet.</p>;

/** Single-series daily bars, baseline at zero; the exact value shows on hover and in the label. */
function Bars({ points, pick, unit }: { points: DailyPoint[]; pick(p: DailyPoint): number; unit: string }) {
  const values = points.map(pick);
  const max = Math.max(...values);
  if (!max) return <Empty />;
  const total = values.reduce((a, b) => a + b, 0);
  return <figure className="admin-bars">
    <div className="admin-bars-plot" role="img" aria-label={`${fmt(total)} ${unit} in total; most in a day: ${fmt(max)}`}>
      {points.map((p, i) => <span key={p.day} className="admin-col" title={`${shortDay(p.day)}: ${fmt(values[i])} ${unit}`}>
        <span className="admin-col-bar" style={{ height: `${(values[i] / max) * 100}%` }} />
      </span>)}
    </div>
    <figcaption className="muted small"><span>{shortDay(points[0].day)}</span><span>max {fmt(max)} · total {fmt(total)}</span><span>{shortDay(points.at(-1)!.day)}</span></figcaption>
  </figure>;
}

/** A ranked list with a bar per row: works as the table view too (exact numbers on every row). */
function Ranked({ items }: { items: Count[] }) {
  if (!items.length) return <Empty />;
  const max = Math.max(...items.map((i) => i.n));
  const total = items.reduce((a, b) => a + b.n, 0);
  return <ol className="admin-ranked">
    {items.map((i) => <li key={i.key}>
      <span className="admin-ranked-label">{label(i.key)}</span>
      <span className="admin-bar-track"><span className="admin-bar" style={{ width: `${(i.n / max) * 100}%` }} title={`${label(i.key)}: ${fmt(i.n)}`} /></span>
      <span className="admin-num">{fmt(i.n)} <small className="muted">{pct(i.n, total)}</small></span>
    </li>)}
  </ol>;
}
