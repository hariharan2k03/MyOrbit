import { endActivitySession, getActiveActivitySession, MAX_ACTIVITY_MS, startActivitySession } from '@/database/repositories/activities';
import { clockInShift, clockOutShift, getShift, type Shift } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { clockState, type ClockRules } from '@/features/work/clock';
import { ValidationError } from '@/utils/result';
import { formatClock } from '@/utils/time';

/**
 * Clocks in if the rules allow it now, and shows the shift countdown in the
 * Dynamic Island / Lock Screen — unless another timer is already running.
 */
export async function clockInNow(db: SqlDb, shiftId: number, rules: ClockRules, now = Date.now()): Promise<Shift> {
  const shift = await getShift(db, shiftId);
  if (!shift) throw new ValidationError('That shift no longer exists.');
  const state = clockState(shift, now, rules);
  if (state.kind === 'not_yet') throw new ValidationError(`Clock in opens at ${formatClock(state.opensAt)}.`);
  if (state.kind === 'missed') throw new ValidationError('This shift has finished. Add the times you worked in the shift instead.');
  if (state.kind !== 'can_clock_in') throw new ValidationError('This shift is already clocked in or finished.');
  await clockInShift(db, shiftId, now);

  try {
    const active = await getActiveActivitySession(db, now);
    if (!active && shift.endAt > now && shift.endAt - now <= MAX_ACTIVITY_MS) {
      await startActivitySession(
        db,
        { kind: 'work', title: shift.workplaceName, subtitle: `Clocked in ${formatClock(now)}`, entityType: 'shift', entityId: shift.id, startsAt: now, endsAt: shift.endAt },
        now,
      );
    }
  } catch (e) {
    // The countdown is a nicety; the clock-in itself is already saved.
    console.warn('Shift Live Activity not started', e);
  }
  return shift;
}

/**
 * Clocks out at `at` (now, or the rostered finish if you forgot), if Clock
 * Out is open, and ends the shift countdown.
 */
export async function clockOutNow(db: SqlDb, shiftId: number, rules: ClockRules, at = Date.now(), now = Date.now()): Promise<void> {
  const shift = await getShift(db, shiftId);
  if (!shift) throw new ValidationError('That shift no longer exists.');
  const state = clockState(shift, now, rules);
  if (state.kind !== 'working') throw new ValidationError('You’re not clocked in to this shift.');
  if (!state.canClockOut) throw new ValidationError(`Clock out opens at ${formatClock(state.clockOutOpensAt)}.`);
  await clockOutShift(db, shiftId, at);
  const active = await getActiveActivitySession(db, now);
  if (active && active.entityType === 'shift' && active.entityId === shiftId) await endActivitySession(db, active.id, 'completed', now);
}
