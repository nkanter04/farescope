import type { SqlDb, SqlValue } from "../sql.ts";

/**
 * `SqlDb` over a Durable Object's SQLite storage. Durable Object SQL is synchronous and the object
 * runs one request step at a time, so the storage classes work unchanged. Transactions use
 * `transactionSync` (raw BEGIN/COMMIT statements are not allowed there).
 */
export function doSql(storage: DurableObjectStorage): SqlDb {
  const sql = storage.sql;
  return {
    prepare(query) {
      return {
        run: (...params: SqlValue[]) => ({ changes: sql.exec(query, ...params).rowsWritten }),
        get: (...params: SqlValue[]) => sql.exec(query, ...params).toArray()[0],
        all: (...params: SqlValue[]) => sql.exec(query, ...params).toArray(),
      };
    },
    exec(query) {
      sql.exec(query);
    },
    transaction: (fn) => storage.transactionSync(fn),
    close() {},
  };
}
