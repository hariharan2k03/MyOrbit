import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { migrate } from './migrations';
import type { SqlDb, SqlValue } from './types';

export const DATABASE_NAME = 'daypilot.db';

let instance: Promise<{ native: SQLiteDatabase; db: SqlDb }> | null = null;

/** Adapts expo-sqlite's overloaded methods to the SqlDb interface. */
function adapt(native: SQLiteDatabase): SqlDb {
  return {
    execAsync: (sql) => native.execAsync(sql),
    runAsync: (sql, params = []) => native.runAsync(sql, params),
    getAllAsync: <T>(sql: string, params: SqlValue[] = []) => native.getAllAsync<T>(sql, params),
    getFirstAsync: <T>(sql: string, params: SqlValue[] = []) => native.getFirstAsync<T>(sql, params),
    withTransactionAsync: (task) => native.withTransactionAsync(task),
  };
}

/**
 * Opens the single app-wide connection, enables WAL + foreign keys and runs
 * migrations. Concurrent callers share one promise so migrations run once.
 */
export async function getDatabase(): Promise<SqlDb> {
  if (!instance) {
    instance = open().catch((e: unknown) => {
      instance = null; // allow a retry from the error screen
      throw e;
    });
  }
  return (await instance).db;
}

async function open() {
  const native = await openDatabaseAsync(DATABASE_NAME);
  await native.execAsync('PRAGMA journal_mode = WAL');
  const db = adapt(native);
  await migrate(db);
  return { native, db };
}

/** Closes and forgets the connection (used before a restore replaces the file). */
export async function closeDatabase(): Promise<void> {
  if (!instance) return;
  const { native } = await instance;
  instance = null;
  await native.closeAsync();
}
