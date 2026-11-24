import { AIRPORT_BY_IATA, type PriceWatch } from "@farescope/shared";
import type { WatchStore } from "./history.ts";
import type { FlightProvider } from "./providers/types.ts";
import { sendPush, type Vapid } from "./push.ts";
import type { SearchCache, SearchQuota } from "./search/run.ts";
import { checkWatch } from "./search/watch.ts";
import type { SqlDb } from "./sql.ts";

/**
 * Weekly price-drop alerts for signed-in accounts, delivered as push notifications. A daily
 * scheduled job (Cloudflare cron → POST /api/internal/alerts-run) re-prices each account's first
 * few watched flights, at most once a week each, from a separate monthly alert budget. When a price
 * falls by at least $5 and 3%, every device the account turned alerts on for gets a push.
 */
export const ALERT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_push_owner ON push_subscriptions (owner);
  CREATE TABLE IF NOT EXISTS push_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_endpoint ON push_inbox (endpoint);
  CREATE TABLE IF NOT EXISTS alert_state (watch_id TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, notified_price REAL);
`;

export const MAX_DEVICES = 5;
const INBOX_DAYS = 7;

export interface AlertMessage { title: string; body: string; url: string }

export class PushStore {
  constructor(private db: SqlDb) {
    db.exec(ALERT_SCHEMA);
  }

  subscribe(owner: string, endpoint: string, now: Date): void {
    this.db.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, owner, created_at) VALUES (?, ?, ?)").run(endpoint, owner, now.getTime());
      // Keep the newest few devices per account.
      const extra = this.db.prepare("SELECT endpoint FROM push_subscriptions WHERE owner = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(owner, MAX_DEVICES) as { endpoint: string }[];
      for (const e of extra) this.remove(e.endpoint);
    });
  }

  /** Removes a device; with `owner`, only if it belongs to that account. */
  unsubscribe(endpoint: string, owner?: string): boolean {
    const r = owner
      ? this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND owner = ?").run(endpoint, owner)
      : this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
    if (Number(r.changes)) this.db.prepare("DELETE FROM push_inbox WHERE endpoint = ?").run(endpoint);
    return Number(r.changes) > 0;
  }

  remove(endpoint: string): void {
    this.unsubscribe(endpoint);
  }

  isSubscribed(endpoint: string, owner: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND owner = ?").get(endpoint, owner);
  }

  owners(): string[] {
    return (this.db.prepare("SELECT DISTINCT owner FROM push_subscriptions WHERE owner LIKE 'user:%'").all() as { owner: string }[]).map((r) => r.owner);
  }

  endpoints(owner: string): string[] {
    return (this.db.prepare("SELECT endpoint FROM push_subscriptions WHERE owner = ?").all(owner) as { endpoint: string }[]).map((r) => r.endpoint);
  }

  devices(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n);
  }

  addMessage(endpoint: string, m: AlertMessage, now: Date): void {
    this.db.prepare("INSERT INTO push_inbox (endpoint, title, body, url, created_at) VALUES (?, ?, ?, ?, ?)").run(endpoint, m.title, m.body, m.url, now.getTime());
  }

  /** The service worker collects its messages after a push (each is shown once). */
  takeMessages(endpoint: string, now: Date): AlertMessage[] {
    return this.db.transaction(() => {
      const rows = this.db.prepare("SELECT title, body, url FROM push_inbox WHERE endpoint = ? AND created_at >= ? ORDER BY id").all(endpoint, now.getTime() - INBOX_DAYS * 86_400_000) as AlertMessage[];
      this.db.prepare("DELETE FROM push_inbox WHERE endpoint = ?").run(endpoint);
      return rows.map((r) => ({ title: r.title, body: r.body, url: r.url }));
    });
  }

  prune(now: Date): void {
    this.db.prepare("DELETE FROM push_inbox WHERE created_at < ?").run(now.getTime() - INBOX_DAYS * 86_400_000);
  }

  state(watchId: string): { checkedAt: number; notifiedPrice: number | null } | undefined {
    const r = this.db.prepare("SELECT checked_at AS c, notified_price AS p FROM alert_state WHERE watch_id = ?").get(watchId) as { c: number; p: number | null } | undefined;
    return r ? { checkedAt: Number(r.c), notifiedPrice: r.p === null ? null : Number(r.p) } : undefined;
  }

  setState(watchId: string, checkedAt: number, notifiedPrice: number | null): void {
    this.db.prepare("INSERT OR REPLACE INTO alert_state (watch_id, checked_at, notified_price) VALUES (?, ?, ?)").run(watchId, checkedAt, notifiedPrice);
  }
}

export interface AlertDeps {
  push: PushStore;
  watches: WatchStore;
  provider: FlightProvider;
  cache: SearchCache;
  /** The alert budget (a shared monthly allowance), not any visitor's or account's. */
  quota: SearchQuota;
  vapid?: Vapid;
  siteUrl: string;
  now?: () => Date;
  /** Watched flights per account that get alerts (oldest first). */
  maxWatches?: number;
  intervalDays?: number;
  send?: typeof sendPush;
}

export interface AlertRun { checked: number; notified: number; credits: number; budgetOut: boolean }

/** A drop worth a notification: at least $5 and 3% below the last price we told them about. */
export const isDrop = (price: number, baseline: number) => price <= baseline - Math.max(5, baseline * 0.03);

export async function runAlerts(d: AlertDeps): Promise<AlertRun> {
  const now = d.now?.() ?? new Date();
  const interval = (d.intervalDays ?? 7) * 86_400_000;
  const run: AlertRun = { checked: 0, notified: 0, credits: 0, budgetOut: false };
  let refused = false;
  const quota: SearchQuota = {
    remaining: (id) => d.quota.remaining(id),
    tryConsume: (id, units) => {
      const r = d.quota.tryConsume(id, units);
      if (!r.ok) refused = true;
      return r;
    },
  };
  d.push.prune(now);
  for (const owner of d.push.owners()) {
    const watches = d.watches.list(owner)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, d.maxWatches ?? 3)
      .filter((w) => w.status !== "departed");
    for (const w of watches) {
      const state = d.push.state(w.id);
      if (state && now.getTime() - state.checkedAt < interval) continue;
      const result = await checkWatch(w, { provider: d.provider, cache: d.cache, quota, clientId: "alerts", now: () => now, force: true });
      run.credits += result.units;
      if (refused) { run.budgetOut = true; return run; }
      if (!result.checked) continue;
      run.checked++;
      d.watches.save(owner, result.watch);
      const baseline = state?.notifiedPrice ?? w.priceAtWatch;
      const price = result.watch.lastPrice;
      if (result.watch.status === "active" && isDrop(price, baseline)) {
        await notify(d, owner, result.watch, baseline, now);
        run.notified++;
        d.push.setState(w.id, now.getTime(), price);
      } else {
        d.push.setState(w.id, now.getTime(), state?.notifiedPrice ?? null);
      }
    }
  }
  return run;
}

async function notify(d: AlertDeps, owner: string, w: PriceWatch, was: number, now: Date) {
  const city = (code: string) => AIRPORT_BY_IATA[code]?.city ?? code;
  const date = new Date(`${w.fare.departDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const message: AlertMessage = {
    title: `Price drop: ${city(w.fare.origin)} → ${city(w.fare.destination)}`,
    body: `Now ${usd(w.lastPrice)} (was ${usd(was)}) for ${date}. Prices change fast, so check it soon.`,
    url: `${d.siteUrl.replace(/\/$/, "")}/app/?view=trips`,
  };
  for (const endpoint of d.push.endpoints(owner)) {
    d.push.addMessage(endpoint, message, now);
    if (d.vapid && (await (d.send ?? sendPush)(endpoint, d.vapid)) === "gone") d.push.remove(endpoint);
  }
}
