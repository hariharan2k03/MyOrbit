import { LATEST_VERSION } from '@/database/migrations';
import type { SqlDb, SqlValue } from '@/database/types';
import { ValidationError } from '@/utils/result';

/** Rebuilt from the data after a restore, so never backed up. */
const SKIP_TABLES = new Set(['reminders']);
/** Device security stays as it is on this iPhone (the passcode lives in the Keychain, not the backup). */
const DEVICE_SETTINGS = ['appLockEnabled', 'autoLockSeconds'];

export interface BackupPayload {
  app: 'MyOrbit';
  schemaVersion: number;
  exportedAt: number;
  tables: Record<string, Record<string, SqlValue>[]>;
}

export interface BackupSummary {
  exportedAt: number;
  counts: { shifts: number; expenses: number; income: number; tasks: number; assessments: number; habits: number };
}

async function userTables(db: SqlDb): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  return rows.map((r) => r.name).filter((n) => !SKIP_TABLES.has(n));
}

async function columnsOf(db: SqlDb, table: string): Promise<Set<string>> {
  const cols = await db.getAllAsync<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, [table]);
  return new Set(cols.map((c) => c.name));
}

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;

export async function exportData(db: SqlDb, now = Date.now()): Promise<BackupPayload> {
  const tables: BackupPayload['tables'] = {};
  for (const t of await userTables(db)) {
    let rows = await db.getAllAsync<Record<string, SqlValue>>(`SELECT * FROM ${quote(t)}`);
    if (t === 'settings') rows = rows.filter((r) => !DEVICE_SETTINGS.includes(String(r.key)));
    tables[t] = rows;
  }
  return { app: 'MyOrbit', schemaVersion: LATEST_VERSION, exportedAt: now, tables };
}

/** Checks a decrypted backup against this app's schema before anything is changed. */
export async function validatePayload(db: SqlDb, text: string): Promise<{ payload: BackupPayload; summary: BackupSummary }> {
  let p: Partial<BackupPayload>;
  try {
    p = JSON.parse(text) as Partial<BackupPayload>;
  } catch {
    throw new ValidationError('This backup file is damaged.');
  }
  if (p.app !== 'MyOrbit' || typeof p.tables !== 'object' || p.tables === null || !Number.isInteger(p.schemaVersion) || typeof p.exportedAt !== 'number') {
    throw new ValidationError('This backup file is damaged.');
  }
  if (p.schemaVersion! > LATEST_VERSION) throw new ValidationError('This backup was made by a newer version of MyOrbit. Update the app first.');
  const known = new Set(await userTables(db));
  for (const [table, rows] of Object.entries(p.tables)) {
    if (!known.has(table) || !Array.isArray(rows)) throw new ValidationError(`This backup contains data MyOrbit doesn’t recognise (${table}).`);
    const cols = await columnsOf(db, table);
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) throw new ValidationError('This backup file is damaged.');
      for (const [k, v] of Object.entries(row)) {
        if (!cols.has(k)) throw new ValidationError(`This backup contains data MyOrbit doesn’t recognise (${table}.${k}).`);
        if (v !== null && typeof v !== 'string' && typeof v !== 'number') throw new ValidationError('This backup file is damaged.');
      }
    }
  }
  const n = (t: string) => p.tables![t]?.length ?? 0;
  return {
    payload: p as BackupPayload,
    summary: {
      exportedAt: p.exportedAt!,
      counts: { shifts: n('work_shifts'), expenses: n('expenses'), income: n('income'), tasks: n('tasks'), assessments: n('assessments'), habits: n('habits') },
    },
  };
}

/**
 * Replaces everything on this iPhone with the backup, in one transaction: if
 * any row fails a constraint or a foreign key, nothing changes. Device
 * security settings are kept.
 */
export async function restoreData(db: SqlDb, payload: BackupPayload): Promise<void> {
  const tables = await userTables(db);
  // Foreign keys are checked once at the end instead of per row, since tables load in any order.
  await db.execAsync('PRAGMA foreign_keys = OFF');
  try {
    await db.withTransactionAsync(async () => {
      for (const t of tables) {
        if (t === 'settings') await db.runAsync(`DELETE FROM settings WHERE key NOT IN (${DEVICE_SETTINGS.map(() => '?').join(', ')})`, DEVICE_SETTINGS);
        else await db.runAsync(`DELETE FROM ${quote(t)}`);
      }
      for (const [t, rows] of Object.entries(payload.tables)) {
        for (const row of rows) {
          if (t === 'settings' && DEVICE_SETTINGS.includes(String(row.key))) continue;
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          await db.runAsync(
            `INSERT INTO ${quote(t)} (${keys.map(quote).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
            keys.map((k) => row[k] ?? null),
          );
        }
      }
      const broken = await db.getAllAsync<{ table: string }>('PRAGMA foreign_key_check');
      if (broken.length > 0) throw new ValidationError('This backup file is damaged (its records don’t match up).');
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON');
  }
}
