import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA, type SqlDb, type SqlValue } from "./sql.ts";

/**
 * SQLite for local dev and tests (Node's built-in driver, no native deps). Production on Cloudflare
 * uses Durable Object SQLite through the same `SqlDb` interface (see do-sql.ts).
 */
export function openDb(path: string): SqlDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...params: SqlValue[]) => stmt.run(...params),
        get: (...params: SqlValue[]) => stmt.get(...params),
        all: (...params: SqlValue[]) => stmt.all(...params),
      };
    },
    exec: (sql) => db.exec(sql),
    transaction(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = fn();
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => db.close(),
  };
}
