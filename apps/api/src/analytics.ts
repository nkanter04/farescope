import { z } from "zod";
import { addDays } from "@farescope/shared";
import type { SqlDb } from "./sql.ts";

/**
 * Tripica's own first-party analytics (no third parties, no cookies). The browser sends small
 * batches of events (page views, engaged time, key actions) tagged with a random per-tab session
 * ID and a one-way hash of its anonymous browser ID. The server adds the visitor's country (from
 * Cloudflare) and device type, and records sign-ups, credits spent and search-limit hits itself.
 * Raw events are deleted after EVENT_RETENTION_DAYS (the privacy policy says so). Owner-only
 * dashboard: GET /api/admin/stats.
 */
export const EVENT_RETENTION_DAYS = 400;

export const EVENT_NAMES = [
  "page_view", // a page or app view (path), with referrer and campaign tags on the first one
  "engaged", // visible time since the last report, in ms
  "search_run",
  "fare_open",
  "trip_save",
  "plan_run",
  "booking_click", // label: "<kind>:<partner>"
  "signin_prompt", // saw "Sign in for more live searches" after hitting the free limit
  "signin_open", // opened the sign-in / sign-up window
  "signed_in", // label: "new" (first time this account was seen) or "returning"
  "install_click",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

const id = z.string().regex(/^[a-zA-Z0-9-]{8,64}$/);
const short = (n: number) => z.string().trim().max(n).optional();
export const EventBatchSchema = z.object({
  visitor: id,
  session: id,
  events: z.array(z.object({
    name: z.enum(EVENT_NAMES),
    path: z.string().trim().max(200).default(""),
    label: short(80),
    ref: short(120),
    utmSource: short(60),
    utmMedium: short(60),
    utmCampaign: short(80),
    ms: z.number().int().min(0).max(6 * 3_600_000).optional(),
  })).min(1).max(25),
});
export type EventBatch = z.infer<typeof EventBatchSchema>;

export const SURVEY_HEARD = ["google", "reddit", "tiktok", "instagram", "youtube", "friend", "other"] as const;
export const SURVEY_AGE = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+", "skip"] as const;
export const SurveySchema = z.object({
  heard: z.enum(SURVEY_HEARD).optional(),
  age: z.enum(SURVEY_AGE).optional(),
}).refine((s) => s.heard || s.age, "Answer at least one question.");

export const ANALYTICS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL, day TEXT NOT NULL,
    visitor TEXT NOT NULL, session TEXT NOT NULL, account INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL, path TEXT, label TEXT, ref TEXT,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
    country TEXT, device TEXT, ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_events_day ON events (day, name);
  CREATE TABLE IF NOT EXISTS accounts_seen (user_id TEXT PRIMARY KEY, first_day TEXT NOT NULL, first_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS daily_stats (
    day TEXT NOT NULL, metric TEXT NOT NULL, dim TEXT NOT NULL DEFAULT '', value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, metric, dim)
  );
  CREATE TABLE IF NOT EXISTS account_survey (user_id TEXT PRIMARY KEY, heard TEXT, age TEXT, at INTEGER NOT NULL);
`;

/** Request facts the server adds to every event. */
export interface EventContext {
  country?: string;
  userAgent?: string;
  signedIn: boolean;
  now: Date;
}

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|httpclient/i;
export const isBot = (ua = "") => !ua || BOT.test(ua);
export function deviceOf(ua = ""): "mobile" | "tablet" | "desktop" {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "mobile";
  return "desktop";
}

/** One-way hash of the anonymous browser ID, so analytics rows can't be joined to saved trips. */
export async function hashVisitor(id: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tripica-analytics:${id}`));
  return [...new Uint8Array(bytes).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A referrer reduced to its host ("www.reddit.com" → "reddit.com"); our own pages don't count. */
export function refHost(ref: string | undefined, ownHost?: string): string | undefined {
  if (!ref) return undefined;
  const host = (/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(ref)?.[1] ?? ref).toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]{3,100}$/.test(host) || (ownHost && host === ownHost.replace(/^www\./, ""))) return undefined;
  return host;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export class Analytics {
  private known = new Set<string>();

  constructor(private db: SqlDb) {
    db.exec(ANALYTICS_SCHEMA);
  }

  async record(batch: EventBatch, ctx: EventContext): Promise<number> {
    if (isBot(ctx.userAgent)) return 0;
    const visitor = await hashVisitor(batch.visitor);
    const at = ctx.now.getTime();
    const day = dayOf(ctx.now);
    const country = ctx.country && /^[A-Z]{2}$/.test(ctx.country) && ctx.country !== "XX" && ctx.country !== "T1" ? ctx.country : null;
    const device = deviceOf(ctx.userAgent);
    const insert = this.db.prepare(
      `INSERT INTO events (at, day, visitor, session, account, name, path, label, ref, utm_source, utm_medium, utm_campaign, country, device, ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const e of batch.events) {
        insert.run(at, day, visitor, batch.session, ctx.signedIn ? 1 : 0, e.name, e.path || null, e.label ?? null, e.ref ?? null,
          e.utmSource?.toLowerCase() ?? null, e.utmMedium?.toLowerCase() ?? null, e.utmCampaign ?? null, country, device, e.ms ?? null);
      }
    });
    return batch.events.length;
  }

  /** Counts an account the first time it's seen (its sign-up). Returns true if it's new. */
  seeUser(userId: string, now: Date): boolean {
    if (this.known.has(userId)) return false;
    this.known.add(userId);
    const r = this.db.prepare("INSERT OR IGNORE INTO accounts_seen (user_id, first_day, first_at) VALUES (?, ?, ?)").run(userId, dayOf(now), now.getTime());
    return Number(r.changes) > 0;
  }

  /** Whether the account signed up in the last day and hasn't answered the survey. */
  surveyDue(userId: string, now: Date): boolean {
    const row = this.db.prepare(
      "SELECT a.first_at AS at, s.user_id AS answered FROM accounts_seen a LEFT JOIN account_survey s ON s.user_id = a.user_id WHERE a.user_id = ?",
    ).get(userId) as { at: number; answered: string | null } | undefined;
    return !!row && !row.answered && now.getTime() - row.at < 86_400_000;
  }

  bump(metric: string, dim: string, value: number, now: Date): void {
    this.db.prepare(
      `INSERT INTO daily_stats (day, metric, dim, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(day, metric, dim) DO UPDATE SET value = value + excluded.value`,
    ).run(dayOf(now), metric, dim, value);
  }

  survey(userId: string, answers: z.infer<typeof SurveySchema>, now: Date): void {
    this.db.prepare("INSERT OR REPLACE INTO account_survey (user_id, heard, age, at) VALUES (?, ?, ?, ?)")
      .run(userId, answers.heard ?? null, answers.age ?? null, now.getTime());
  }

  prune(now: Date): number {
    return Number(this.db.prepare("DELETE FROM events WHERE day < ?").run(addDays(dayOf(now), -EVENT_RETENTION_DAYS)).changes);
  }

  stats(days: number, now: Date): DashboardStats {
    const today = dayOf(now);
    const from = addDays(today, -(days - 1));
    const all = <T>(sql: string, ...p: (string | number)[]) => this.db.prepare(sql).all(...p) as T[];
    const one = <T>(sql: string, ...p: (string | number)[]) => this.db.prepare(sql).get(...p) as T;
    const counts = (sql: string, ...p: (string | number)[]) => all<{ key: string | null; n: number }>(sql, ...p).map((r) => ({ key: r.key ?? "(none)", n: Number(r.n) }));

    const totals = one<{ visitors: number; sessions: number; views: number }>(
      `SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT session) AS sessions,
              SUM(CASE WHEN name = 'page_view' THEN 1 ELSE 0 END) AS views FROM events WHERE day >= ?`, from);
    const returning = one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (SELECT visitor FROM events WHERE day >= ? GROUP BY visitor HAVING COUNT(DISTINCT day) > 1)`, from).n;
    const perSession = all<{ ms: number }>(
      "SELECT SUM(ms) AS ms FROM events WHERE day >= ? AND name = 'engaged' GROUP BY session", from).map((r) => Number(r.ms)).sort((a, b) => a - b);
    const sessions = Number(totals.sessions) || 0;
    const engagedTotal = perSession.reduce((s, v) => s + v, 0);

    const signups = Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM accounts_seen WHERE first_day >= ?", from).n);
    const statSum = (metric: string) => counts("SELECT dim AS key, SUM(value) AS n FROM daily_stats WHERE day >= ? AND metric = ? GROUP BY dim ORDER BY n DESC", from, metric);
    const sessionsWith = (name: string, label?: string) => Number(one<{ n: number }>(
      `SELECT COUNT(DISTINCT session) AS n FROM events WHERE day >= ? AND name = ?${label ? " AND label = ?" : ""}`, ...(label ? [from, name, label] : [from, name])).n);

    const daily = new Map<string, DailyPoint>();
    for (let d = from; d <= today; d = addDays(d, 1)) daily.set(d, { day: d, visitors: 0, sessions: 0, signups: 0, credits: 0 });
    for (const r of all<{ day: string; v: number; s: number }>("SELECT day, COUNT(DISTINCT visitor) AS v, COUNT(DISTINCT session) AS s FROM events WHERE day >= ? GROUP BY day", from)) {
      const p = daily.get(r.day); if (p) { p.visitors = Number(r.v); p.sessions = Number(r.s); }
    }
    for (const r of all<{ day: string; n: number }>("SELECT first_day AS day, COUNT(*) AS n FROM accounts_seen WHERE first_day >= ? GROUP BY first_day", from)) {
      const p = daily.get(r.day); if (p) p.signups = Number(r.n);
    }
    for (const r of all<{ day: string; n: number }>("SELECT day, SUM(value) AS n FROM daily_stats WHERE day >= ? AND metric = 'credits' GROUP BY day", from)) {
      const p = daily.get(r.day); if (p) p.credits = Number(r.n);
    }

    const bySession = (col: string, where = "") => counts(
      `SELECT ${col} AS key, COUNT(DISTINCT session) AS n FROM events WHERE day >= ?${where} GROUP BY ${col} ORDER BY n DESC LIMIT 12`, from);

    return {
      range: { from, to: today, days },
      countingSince: one<{ d: string | null }>("SELECT MIN(day) AS d FROM events").d ?? today,
      totals: {
        visitors: Number(totals.visitors) || 0,
        returningVisitors: Number(returning) || 0,
        sessions,
        pageViews: Number(totals.views) || 0,
        avgEngagedMs: sessions ? Math.round(engagedTotal / sessions) : 0,
        medianEngagedMs: perSession.length ? perSession[Math.floor(perSession.length / 2)] : 0,
        signups,
        accounts: Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM accounts_seen").n),
      },
      daily: [...daily.values()],
      monthlySignups: counts("SELECT substr(first_day, 1, 7) AS key, COUNT(*) AS n FROM accounts_seen GROUP BY key ORDER BY key DESC LIMIT 12").reverse(),
      funnel: [
        { step: "Visited", sessions },
        { step: "Ran a search", sessions: sessionsWith("search_run") },
        { step: "Hit the free limit", sessions: sessionsWith("signin_prompt") },
        { step: "Opened sign-up", sessions: sessionsWith("signin_open") },
        { step: "Created an account", sessions: sessionsWith("signed_in", "new") },
      ],
      credits: statSum("credits"),
      limitHits: statSum("limit"),
      actions: counts("SELECT name AS key, COUNT(*) AS n FROM events WHERE day >= ? AND name IN ('search_run','fare_open','trip_save','plan_run','booking_click','install_click') GROUP BY name ORDER BY n DESC", from),
      bookingClicks: counts("SELECT label AS key, COUNT(*) AS n FROM events WHERE day >= ? AND name = 'booking_click' GROUP BY label ORDER BY n DESC LIMIT 12", from),
      referrers: bySession("ref", " AND name = 'page_view' AND ref IS NOT NULL"),
      campaigns: bySession("utm_source", " AND name = 'page_view' AND utm_source IS NOT NULL"),
      countries: bySession("country"),
      devices: bySession("device"),
      pages: counts("SELECT path AS key, COUNT(*) AS n FROM events WHERE day >= ? AND name = 'page_view' GROUP BY path ORDER BY n DESC LIMIT 12", from),
      survey: {
        answers: Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM account_survey").n),
        heard: counts("SELECT heard AS key, COUNT(*) AS n FROM account_survey WHERE heard IS NOT NULL GROUP BY heard ORDER BY n DESC"),
        age: counts("SELECT age AS key, COUNT(*) AS n FROM account_survey WHERE age IS NOT NULL GROUP BY age ORDER BY key"),
      },
    };
  }
}

export interface DailyPoint { day: string; visitors: number; sessions: number; signups: number; credits: number }
export interface Count { key: string; n: number }
export interface DashboardStats {
  range: { from: string; to: string; days: number };
  countingSince: string;
  totals: {
    visitors: number; returningVisitors: number; sessions: number; pageViews: number;
    avgEngagedMs: number; medianEngagedMs: number; signups: number; accounts: number;
  };
  daily: DailyPoint[];
  monthlySignups: Count[];
  funnel: { step: string; sessions: number }[];
  credits: Count[];
  limitHits: Count[];
  actions: Count[];
  bookingClicks: Count[];
  referrers: Count[];
  campaigns: Count[];
  countries: Count[];
  devices: Count[];
  pages: Count[];
  survey: { answers: number; heard: Count[]; age: Count[] };
}
