import { ValidationError } from '@/utils/result';
import type { SqlDb } from '../types';

export type ActivityKind = 'work' | 'study' | 'focus' | 'break';

/**
 * A timed session that drives a Live Activity. All countdowns are derived from
 * startsAt/endsAt, so the app can be killed and the state recovered on launch.
 */
export interface ActivitySession {
  id: number;
  kind: ActivityKind;
  title: string;
  subtitle: string | null;
  entityType: string | null;
  entityId: number | null;
  startsAt: number;
  endsAt: number;
  nativeActivityId: string | null;
  nextActivity: string | null;
}

export interface StartActivityInput {
  kind: ActivityKind;
  title: string;
  subtitle?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  startsAt: number;
  endsAt: number;
  nextActivity?: string | null;
}

type Row = {
  id: number;
  kind: ActivityKind;
  title: string;
  subtitle: string | null;
  entity_type: string | null;
  entity_id: number | null;
  starts_at: number;
  ends_at: number;
  native_activity_id: string | null;
  next_activity: string | null;
};

const toSession = (r: Row): ActivitySession => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  subtitle: r.subtitle,
  entityType: r.entity_type,
  entityId: r.entity_id,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  nativeActivityId: r.native_activity_id,
  nextActivity: r.next_activity,
});

export const MAX_ACTIVITY_MS = 12 * 3_600_000; // iOS ends Live Activities after ~8h active + 4h on Lock Screen.

/**
 * Starts a session, cancelling any previous active one first so there is
 * never more than one — a partial unique index in SQLite also enforces this.
 */
export async function startActivitySession(db: SqlDb, input: StartActivityInput, now = Date.now()): Promise<ActivitySession> {
  if (!(input.endsAt > input.startsAt)) throw new ValidationError('Session must end after it starts.');
  if (input.endsAt - input.startsAt > MAX_ACTIVITY_MS) throw new ValidationError('Sessions can be at most 12 hours.');
  if (input.endsAt <= now) throw new ValidationError('That session has already finished.');
  const previous = await db.getFirstAsync<{ id: number }>(`SELECT id FROM activity_sessions WHERE status = 'active'`);
  if (previous) await endActivitySession(db, previous.id, 'cancelled', now);
  let id = 0;
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      `INSERT INTO activity_sessions (kind, title, subtitle, entity_type, entity_id, starts_at, ends_at, next_activity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.kind,
        input.title.slice(0, 80),
        input.subtitle?.slice(0, 80) ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
        input.startsAt,
        input.endsAt,
        input.nextActivity?.slice(0, 80) ?? null,
        now,
      ],
    );
    id = r.lastInsertRowId;
  });
  const row = await db.getFirstAsync<Row>('SELECT * FROM activity_sessions WHERE id = ?', [id]);
  return toSession(row!);
}

export async function setNativeActivityId(db: SqlDb, id: number, nativeId: string | null): Promise<void> {
  await db.runAsync('UPDATE activity_sessions SET native_activity_id = ? WHERE id = ?', [nativeId, id]);
}

export async function endActivitySession(db: SqlDb, id: number, status: 'completed' | 'cancelled', now = Date.now()): Promise<void> {
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<Row>(`SELECT * FROM activity_sessions WHERE id = ? AND status = 'active'`, [id]);
    if (!row) return;
    const endedAt = Math.min(now, row.ends_at);
    await db.runAsync('UPDATE activity_sessions SET status = ?, ended_at = ? WHERE id = ?', [status, endedAt, id]);
    // A timed study session also closes its study log entry, so the minutes count.
    if (row.entity_type === 'study' && row.entity_id !== null) {
      await db.runAsync('UPDATE study_sessions SET ended_at = MAX(?, started_at) WHERE id = ? AND ended_at IS NULL', [endedAt, row.entity_id]);
    }
  });
}

/**
 * Returns the active session, auto-completing it if its end time has passed
 * (e.g. the app was closed while it ran). Used for restart recovery.
 */
export async function getActiveActivitySession(db: SqlDb, now = Date.now()): Promise<ActivitySession | null> {
  const row = await db.getFirstAsync<Row>(`SELECT * FROM activity_sessions WHERE status = 'active'`);
  if (!row) return null;
  if (row.ends_at <= now) {
    await endActivitySession(db, row.id, 'completed', row.ends_at);
    return null;
  }
  return toSession(row);
}
