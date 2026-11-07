import type { PayRates } from '@/features/work/payRates';
import { computeShift, overlaps, type ShiftInput } from '@/features/work/shiftMath';
import { assertCents, type Cents } from '@/utils/money';
import { unwrap, ValidationError } from '@/utils/result';
import type { DateKey, DateRange } from '@/utils/time';
import { cleanText, LIMITS } from '@/utils/validation';
import type { SqlDb } from '../types';

export interface Workplace {
  id: number;
  name: string;
  defaultRateCents: Cents;
  address: string | null;
  color: string;
  notes: string | null;
  archived: boolean;
  /** Penalty rates in cents/hour; null means that penalty doesn't apply. */
  saturdayRateCents: Cents | null;
  sundayRateCents: Cents | null;
  nightRateCents: Cents | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
}

export type ShiftStatus = 'scheduled' | 'completed' | 'cancelled';

export interface Shift {
  id: number;
  workplaceId: number;
  workplaceName: string;
  workplaceColor: string;
  shiftDate: DateKey;
  startAt: number;
  endAt: number;
  unpaidBreakMinutes: number;
  hourlyRateCents: Cents;
  status: ShiftStatus;
  reminderMinutes: number | null;
  notes: string | null;
  /** The shift's base rate plus its workplace's penalty rates. */
  rates: PayRates;
}

interface PenaltyRow {
  saturday_rate_cents: number | null;
  sunday_rate_cents: number | null;
  night_rate_cents: number | null;
  night_start_min: number | null;
  night_end_min: number | null;
}

interface WorkplaceRow extends PenaltyRow {
  id: number;
  name: string;
  default_rate_cents: number;
  address: string | null;
  color: string;
  notes: string | null;
  archived: number;
}

interface ShiftRow extends PenaltyRow {
  id: number;
  workplace_id: number;
  workplace_name: string;
  workplace_color: string;
  shift_date: string;
  start_at: number;
  end_at: number;
  unpaid_break_minutes: number;
  hourly_rate_cents: number;
  status: ShiftStatus;
  reminder_minutes: number | null;
  notes: string | null;
}

const toWorkplace = (r: WorkplaceRow): Workplace => ({
  id: r.id,
  name: r.name,
  defaultRateCents: r.default_rate_cents,
  address: r.address,
  color: r.color,
  notes: r.notes,
  archived: r.archived === 1,
  saturdayRateCents: r.saturday_rate_cents,
  sundayRateCents: r.sunday_rate_cents,
  nightRateCents: r.night_rate_cents,
  nightStartMin: r.night_start_min,
  nightEndMin: r.night_end_min,
});

const toShift = (r: ShiftRow): Shift => ({
  id: r.id,
  workplaceId: r.workplace_id,
  workplaceName: r.workplace_name,
  workplaceColor: r.workplace_color,
  shiftDate: r.shift_date,
  startAt: r.start_at,
  endAt: r.end_at,
  unpaidBreakMinutes: r.unpaid_break_minutes,
  hourlyRateCents: r.hourly_rate_cents,
  status: r.status,
  reminderMinutes: r.reminder_minutes,
  notes: r.notes,
  rates: {
    baseCents: r.hourly_rate_cents,
    saturdayCents: r.saturday_rate_cents,
    sundayCents: r.sunday_rate_cents,
    nightCents: r.night_rate_cents,
    nightStartMin: r.night_start_min,
    nightEndMin: r.night_end_min,
  },
});

export interface WorkplaceInput {
  name: string;
  defaultRateCents: Cents;
  address?: string | null;
  color?: string;
  notes?: string | null;
  saturdayRateCents?: Cents | null;
  sundayRateCents?: Cents | null;
  nightRateCents?: Cents | null;
  nightStartMin?: number | null;
  nightEndMin?: number | null;
}

function cleanWorkplace(input: WorkplaceInput) {
  assertCents(input.defaultRateCents, 'Hourly rate');
  for (const [v, label] of [
    [input.saturdayRateCents, 'Saturday rate'],
    [input.sundayRateCents, 'Sunday rate'],
    [input.nightRateCents, 'Night rate'],
  ] as const) {
    if (v !== null && v !== undefined) assertCents(v, label);
  }
  const night = input.nightRateCents ?? null;
  const start = input.nightStartMin ?? null;
  const end = input.nightEndMin ?? null;
  if (night !== null) {
    const ok = (m: number | null) => m !== null && Number.isInteger(m) && m >= 0 && m < 1440;
    if (!ok(start) || !ok(end) || start === end) throw new ValidationError('Night pay needs a start and end time that differ.');
  }
  return {
    saturday: input.saturdayRateCents ?? null,
    sunday: input.sundayRateCents ?? null,
    night,
    nightStart: night === null ? null : start,
    nightEnd: night === null ? null : end,
    name: unwrap(cleanText(input.name, 'Workplace name', LIMITS.name, { required: true })),
    address: unwrap(cleanText(input.address, 'Address', LIMITS.title)) || null,
    notes: unwrap(cleanText(input.notes, 'Notes', LIMITS.notes)) || null,
    color: /^#[0-9A-Fa-f]{6}$/.test(input.color ?? '') ? input.color! : '#5B8DEF',
  };
}

export async function listWorkplaces(db: SqlDb, opts: { includeArchived?: boolean } = {}): Promise<Workplace[]> {
  const rows = await db.getAllAsync<WorkplaceRow>(
    `SELECT * FROM workplaces ${opts.includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name`,
  );
  return rows.map(toWorkplace);
}

export async function createWorkplace(db: SqlDb, input: WorkplaceInput): Promise<number> {
  const w = cleanWorkplace(input);
  const now = Date.now();
  try {
    const r = await db.runAsync(
      `INSERT INTO workplaces (name, default_rate_cents, address, color, notes, saturday_rate_cents, sunday_rate_cents,
         night_rate_cents, night_start_min, night_end_min, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [w.name, input.defaultRateCents, w.address, w.color, w.notes, w.saturday, w.sunday, w.night, w.nightStart, w.nightEnd, now, now],
    );
    return r.lastInsertRowId;
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ValidationError('A workplace with that name already exists.');
    throw e;
  }
}

export async function updateWorkplace(db: SqlDb, id: number, input: WorkplaceInput): Promise<void> {
  const w = cleanWorkplace(input);
  await db.runAsync(
    `UPDATE workplaces SET name = ?, default_rate_cents = ?, address = ?, color = ?, notes = ?, saturday_rate_cents = ?,
       sunday_rate_cents = ?, night_rate_cents = ?, night_start_min = ?, night_end_min = ?, updated_at = ? WHERE id = ?`,
    [w.name, input.defaultRateCents, w.address, w.color, w.notes, w.saturday, w.sunday, w.night, w.nightStart, w.nightEnd, Date.now(), id],
  );
}

/** Workplaces with shifts are archived rather than deleted so history is kept. */
export async function removeWorkplace(db: SqlDb, id: number): Promise<'deleted' | 'archived'> {
  const used = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM work_shifts WHERE workplace_id = ?', [id]);
  if ((used?.n ?? 0) > 0) {
    await db.runAsync('UPDATE workplaces SET archived = 1, updated_at = ? WHERE id = ?', [Date.now(), id]);
    return 'archived';
  }
  await db.runAsync('DELETE FROM workplaces WHERE id = ?', [id]);
  return 'deleted';
}

const SHIFT_SELECT = `SELECT s.*, w.name AS workplace_name, w.color AS workplace_color,
  w.saturday_rate_cents, w.sunday_rate_cents, w.night_rate_cents, w.night_start_min, w.night_end_min
  FROM work_shifts s JOIN workplaces w ON w.id = s.workplace_id`;

export interface ShiftSaveInput extends ShiftInput {
  workplaceId: number;
  reminderMinutes?: number | null;
  notes?: string | null;
}

/**
 * Validates times and rejects overlaps with other non-cancelled shifts, which
 * also catches duplicate entries (same workplace + start is UNIQUE in SQL too).
 */
async function prepareShift(db: SqlDb, input: ShiftSaveInput, excludeId: number | null) {
  const times = unwrap(computeShift(input));
  const notes = unwrap(cleanText(input.notes, 'Notes', LIMITS.notes)) || null;
  const reminder = input.reminderMinutes ?? null;
  if (reminder !== null && (!Number.isInteger(reminder) || reminder < 0 || reminder > 1440)) {
    throw new ValidationError('Reminder must be between 0 and 1440 minutes before the shift.');
  }
  const clashes = await db.getAllAsync<{ id: number; start_at: number; end_at: number }>(
    `SELECT id, start_at, end_at FROM work_shifts
     WHERE status != 'cancelled' AND start_at < ? AND end_at > ? AND id != ?`,
    [times.endAt, times.startAt, excludeId ?? -1],
  );
  if (clashes.some((c) => overlaps(times, { startAt: c.start_at, endAt: c.end_at }))) {
    throw new ValidationError('This shift overlaps another shift.');
  }
  return { times, notes, reminder };
}

export async function createShift(db: SqlDb, input: ShiftSaveInput): Promise<number> {
  const { times, notes, reminder } = await prepareShift(db, input, null);
  const now = Date.now();
  const r = await db.runAsync(
    `INSERT INTO work_shifts (workplace_id, shift_date, start_at, end_at, unpaid_break_minutes, hourly_rate_cents,
       reminder_minutes, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.workplaceId, input.date, times.startAt, times.endAt, input.unpaidBreakMinutes, input.hourlyRateCents, reminder, notes, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateShift(db: SqlDb, id: number, input: ShiftSaveInput): Promise<void> {
  const { times, notes, reminder } = await prepareShift(db, input, id);
  await db.runAsync(
    `UPDATE work_shifts SET workplace_id = ?, shift_date = ?, start_at = ?, end_at = ?, unpaid_break_minutes = ?,
       hourly_rate_cents = ?, reminder_minutes = ?, notes = ?, updated_at = ? WHERE id = ?`,
    [input.workplaceId, input.date, times.startAt, times.endAt, input.unpaidBreakMinutes, input.hourlyRateCents, reminder, notes, Date.now(), id],
  );
}

export async function setShiftStatus(db: SqlDb, id: number, status: ShiftStatus): Promise<void> {
  await db.runAsync('UPDATE work_shifts SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
}

export async function deleteShift(db: SqlDb, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM reminders WHERE entity_type = 'shift' AND entity_id = ?`, [id]);
    await db.runAsync('DELETE FROM work_shifts WHERE id = ?', [id]);
  });
}

export async function getShift(db: SqlDb, id: number): Promise<Shift | null> {
  const row = await db.getFirstAsync<ShiftRow>(`${SHIFT_SELECT} WHERE s.id = ?`, [id]);
  return row ? toShift(row) : null;
}

export async function listShiftsInRange(db: SqlDb, range: DateRange): Promise<Shift[]> {
  const rows = await db.getAllAsync<ShiftRow>(
    `${SHIFT_SELECT} WHERE s.shift_date >= ? AND s.shift_date < ? ORDER BY s.start_at`,
    [range.start, range.end],
  );
  return rows.map(toShift);
}

export async function listUpcomingShifts(db: SqlDb, now: number, limit = 5): Promise<Shift[]> {
  const rows = await db.getAllAsync<ShiftRow>(
    `${SHIFT_SELECT} WHERE s.end_at > ? AND s.status = 'scheduled' ORDER BY s.start_at LIMIT ?`,
    [now, limit],
  );
  return rows.map(toShift);
}
