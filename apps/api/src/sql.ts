/**
 * The small slice of SQLite the storage classes use. Node's `node:sqlite` (local dev, tests) and
 * Cloudflare Durable Object SQLite (production) both implement it, so the same storage code runs
 * on both. Keep this file free of runtime imports.
 */
export type SqlValue = string | number | null;

export interface SqlStatement {
  run(...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

export interface SqlDb {
  prepare(sql: string): SqlStatement;
  /** Run one or more statements with no parameters (schema). */
  exec(sql: string): void;
  /** Run `fn` atomically. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Tables and indexes. Plain SQL so it also ports to Postgres later. */
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS query_cache (
    key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  -- Every real fare we ever see. Over time this becomes our own long-range price history.
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    depart_date TEXT NOT NULL,
    return_date TEXT,
    cabin TEXT NOT NULL,
    price REAL NOT NULL,
    stops INTEGER NOT NULL,
    airlines TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ph_route ON price_history (origin, destination, depart_date);
  CREATE TABLE IF NOT EXISTS scoped_history (
    search_key TEXT NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL,
    depart_date TEXT NOT NULL, day TEXT NOT NULL, price REAL NOT NULL,
    PRIMARY KEY(search_key, origin, destination, day)
  );
  CREATE TABLE IF NOT EXISTS usage (
    bucket TEXT NOT NULL,
    period TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, period)
  );
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips (owner, created_at);
  CREATE TABLE IF NOT EXISTS watches (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_watches_owner ON watches (owner, created_at);
  -- Tripica Pro subscriptions, kept in sync by Stripe webhooks.
  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY,
    customer_id TEXT,
    subscription_id TEXT,
    status TEXT,
    plan TEXT,
    trial_end INTEGER,
    period_end INTEGER,
    trial_used INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
`;
