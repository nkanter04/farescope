import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite for local dev (Node's built-in driver, no native deps). The schema is plain SQL so it
 * ports directly to Postgres/Supabase in Phase 4.
 */
export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
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
  `);
  return db;
}
