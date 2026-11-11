import { cancelShiftFromRoster, createShift, rescheduleShift, type Shift } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { computeShift } from '@/features/work/shiftMath';
import { unwrap } from '@/utils/result';
import { addDays, formatDateKey, formatTimeRange, startOfWeek, type DateKey } from '@/utils/time';

/** One shift read from the roster, as the user reviews and edits it before saving. */
export interface RosterDraft {
  key: string;
  date: DateKey;
  startTime: string;
  endTime: string;
  source: string;
}

export type RosterChange =
  | { kind: 'new'; draft: RosterDraft }
  | { kind: 'same'; draft: RosterDraft; existing: Shift }
  | { kind: 'changed'; draft: RosterDraft; existing: Shift }
  /** Saved for a day the roster covers, but no longer on it. */
  | { kind: 'removed'; existing: Shift };

/** Every date in the weeks the roster's shifts fall in (a day off is still "covered"). */
export function coveredDates(drafts: RosterDraft[]): Set<DateKey> {
  const out = new Set<DateKey>();
  for (const d of drafts) {
    const monday = startOfWeek(d.date, 1);
    for (let i = 0; i < 7; i++) out.add(addDays(monday, i));
  }
  return out;
}

const timesOf = (d: RosterDraft) => unwrap(computeShift({ date: d.date, startTime: d.startTime, endTime: d.endTime, unpaidBreakMinutes: 0, hourlyRateCents: 0 }));
const overlap = (a: { startAt: number; endAt: number }, b: { startAt: number; endAt: number }) => Math.max(0, Math.min(a.endAt, b.endAt) - Math.max(a.startAt, b.startAt));

/**
 * Compares a roster with the shifts already saved at that workplace. A shift
 * on the same day is matched to the roster shift it overlaps most (or the
 * only one that day), so a shift moved from 12–4 to 1–5 shows as "changed",
 * not as one new and one removed. Shifts you've clocked into are left alone.
 */
export function diffRoster(existing: Shift[], drafts: RosterDraft[]): RosterChange[] {
  const covered = coveredDates(drafts);
  const pool = existing.filter((s) => s.status !== 'cancelled' && covered.has(s.shiftDate));
  const used = new Set<number>();
  const out: RosterChange[] = [];
  for (const draft of drafts) {
    const t = timesOf(draft);
    const sameDay = pool.filter((s) => !used.has(s.id) && s.shiftDate === draft.date);
    const best = sameDay
      .map((s) => ({ s, o: overlap(t, s) }))
      .sort((a, b) => b.o - a.o || Math.abs(a.s.startAt - t.startAt) - Math.abs(b.s.startAt - t.startAt))[0];
    // With several shifts that day, only an overlapping one counts as "the same shift".
    const match = best && (best.o > 0 || sameDay.length === 1) ? best.s : undefined;
    if (!match) {
      out.push({ kind: 'new', draft });
      continue;
    }
    used.add(match.id);
    if (match.startAt === t.startAt && match.endAt === t.endAt) out.push({ kind: 'same', draft, existing: match });
    else out.push({ kind: 'changed', draft, existing: match });
  }
  for (const s of pool) {
    if (!used.has(s.id) && s.status === 'scheduled' && s.clockInAt === null) out.push({ kind: 'removed', existing: s });
  }
  return out;
}

/** Whether a change is saved by default: everything except removing a shift you added yourself. */
export function includedByDefault(c: RosterChange): boolean {
  if (c.kind === 'removed') return c.existing.source === 'roster';
  if (c.kind === 'changed') return c.existing.clockInAt === null;
  return c.kind === 'new';
}

export interface ApplyResult {
  added: number;
  changed: number;
  cancelled: number;
  /** One line per change, for the "Roster updated" notification. */
  lines: string[];
}

const describe = (date: DateKey, start: number, end: number) => `${formatDateKey(date, { weekday: true })} ${formatTimeRange(start, end)}`;

/**
 * Saves the chosen changes in one transaction: cancellations first, then
 * moves, then new shifts, so a shift can move into a slot another one left.
 */
export async function applyRoster(
  db: SqlDb,
  changes: RosterChange[],
  opts: { workplaceId: number; hourlyRateCents: number; unpaidBreakMinutes: number },
  now = Date.now(),
): Promise<ApplyResult> {
  const result: ApplyResult = { added: 0, changed: 0, cancelled: 0, lines: [] };
  await db.withTransactionAsync(async () => {
    for (const c of changes) {
      if (c.kind !== 'removed') continue;
      await cancelShiftFromRoster(db, c.existing.id, now);
      result.cancelled++;
      result.lines.push(`Removed: ${describe(c.existing.shiftDate, c.existing.startAt, c.existing.endAt)}`);
    }
    for (const c of changes) {
      if (c.kind !== 'changed') continue;
      await rescheduleShift(db, c.existing.id, c.draft.date, c.draft.startTime, c.draft.endTime, now);
      const t = timesOf(c.draft);
      result.changed++;
      result.lines.push(`Changed: ${formatDateKey(c.draft.date, { weekday: true })} ${formatTimeRange(c.existing.startAt, c.existing.endAt)} → ${formatTimeRange(t.startAt, t.endAt)}`);
    }
    for (const c of changes) {
      if (c.kind !== 'new') continue;
      await createShift(db, {
        workplaceId: opts.workplaceId,
        date: c.draft.date,
        startTime: c.draft.startTime,
        endTime: c.draft.endTime,
        unpaidBreakMinutes: opts.unpaidBreakMinutes,
        hourlyRateCents: opts.hourlyRateCents,
        source: 'roster',
      });
      const t = timesOf(c.draft);
      result.added++;
      result.lines.push(`New: ${describe(c.draft.date, t.startAt, t.endAt)}`);
    }
  });
  return result;
}
