import { MINUTE_MS } from '@/utils/time';

/** When the Clock In and Clock Out buttons unlock, relative to the rostered times. */
export interface ClockRules {
  /** Clock in opens this many minutes before the shift starts. */
  clockInEarlyMinutes: number;
  /** Clock out opens this many minutes before the shift ends. */
  clockOutEarlyMinutes: number;
}

export const CLOCK_IN_EARLY_OPTIONS = [0, 5, 10, 15, 20, 30] as const;
export const CLOCK_OUT_EARLY_OPTIONS = [0, 5, 10, 15, 30, 45, 60] as const;

interface ClockShift {
  startAt: number;
  endAt: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  clockInAt: number | null;
  clockOutAt: number | null;
}

export type ClockState =
  /** Too early: Clock In unlocks at `opensAt`. */
  | { kind: 'not_yet'; opensAt: number }
  /** Clock In is available. `late` once the shift has started. */
  | { kind: 'can_clock_in'; late: boolean }
  /** Clocked in. Clock Out unlocks at `clockOutOpensAt`; `overtime` once past the rostered finish. */
  | { kind: 'working'; clockedInAt: number; canClockOut: boolean; clockOutOpensAt: number; overtime: boolean }
  | { kind: 'done'; clockedInAt: number | null; clockedOutAt: number | null }
  /** The shift ended without a clock-in. Times can still be added in the shift editor. */
  | { kind: 'missed' }
  | { kind: 'cancelled' };

export function clockOpensAt(shift: { startAt: number }, rules: ClockRules): number {
  return shift.startAt - rules.clockInEarlyMinutes * MINUTE_MS;
}

export function clockOutOpensAt(shift: { endAt: number }, rules: ClockRules): number {
  return shift.endAt - rules.clockOutEarlyMinutes * MINUTE_MS;
}

export function clockState(shift: ClockShift, now: number, rules: ClockRules): ClockState {
  if (shift.status === 'cancelled') return { kind: 'cancelled' };
  if (shift.status === 'completed' || shift.clockOutAt !== null) return { kind: 'done', clockedInAt: shift.clockInAt, clockedOutAt: shift.clockOutAt };
  if (shift.clockInAt !== null) {
    const opens = clockOutOpensAt(shift, rules);
    return { kind: 'working', clockedInAt: shift.clockInAt, canClockOut: now >= opens, clockOutOpensAt: opens, overtime: now > shift.endAt };
  }
  if (now >= shift.endAt) return { kind: 'missed' };
  const opens = clockOpensAt(shift, rules);
  if (now < opens) return { kind: 'not_yet', opensAt: opens };
  return { kind: 'can_clock_in', late: now > shift.startAt };
}

/**
 * The span used for hours and pay: the clocked times once you've clocked in
 * and out, otherwise the rostered times.
 */
export function worked<T extends { startAt: number; endAt: number; clockInAt: number | null; clockOutAt: number | null }>(shift: T): T {
  if (shift.clockInAt === null || shift.clockOutAt === null || shift.clockOutAt <= shift.clockInAt) return shift;
  return { ...shift, startAt: shift.clockInAt, endAt: shift.clockOutAt };
}

/** Minutes clocked vs rostered (positive = worked longer). Null until clocked out. */
export function clockedDifference(shift: { startAt: number; endAt: number; clockInAt: number | null; clockOutAt: number | null }): number | null {
  if (shift.clockInAt === null || shift.clockOutAt === null) return null;
  return Math.round((shift.clockOutAt - shift.clockInAt - (shift.endAt - shift.startAt)) / MINUTE_MS);
}

/** "1h 12m" style elapsed time for the live clock, with seconds. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * The instant on the day nearest to `target` for a wall-clock "HH:mm" — so a
 * clock-out of 00:15 on a late shift lands on the next day.
 */
export function nearestInstant(dateKeyTimes: [Date, Date, Date], minutes: number, target: number): number {
  let best = 0;
  for (const day of dateKeyTimes) {
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();
    if (best === 0 || Math.abs(t - target) < Math.abs(best - target)) best = t;
  }
  return best;
}
