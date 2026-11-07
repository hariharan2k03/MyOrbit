import Database from 'better-sqlite3';
import { migrate } from '@/database/migrations';
import type { SqlDb, SqlValue } from '@/database/types';

/**
 * Wraps an in-memory better-sqlite3 database in the SqlDb interface so
 * repository tests run the exact production SQL against real SQLite.
 */
export function createRawTestDb(): SqlDb & { raw: Database.Database } {
  const raw = new Database(':memory:');
  let depth = 0;
  return {
    raw,
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, params: SqlValue[] = []) {
      const r = raw.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    async getAllAsync<T>(sql: string, params: SqlValue[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[] = []) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      // Mirrors expo-sqlite: BEGIN … COMMIT, ROLLBACK on error. Nesting fails there too.
      if (depth > 0) throw new Error('cannot start a transaction within a transaction');
      depth++;
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}

export async function createTestDb() {
  const db = createRawTestDb();
  await migrate(db);
  return db;
}
