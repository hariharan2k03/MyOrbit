import { assertCents, type Cents } from '@/utils/money';
import { err, ok, type Result } from '@/utils/result';
import { addDays, localDateTime, MINUTE_MS, parseDateKey, parseTime, type DateKey } from '@/utils/time';

export interface ShiftInput {
  date: DateKey;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  unpaidBreakMinutes: number;
  hourlyRateCents: Cents;
}

export interface ShiftTimes {
  startAt: number;
  endAt: number;
  overnight: boolean;
  /** Real elapsed minutes, so a shift across a DST change is 1h longer/shorter. */
  durationMinutes: number;
  paidMinutes: number;
  estimatedEarningsCents: Cents;
}

export const MAX_SHIFT_MINUTES = 16 * 60;

/**
 * Resolves a shift's wall-clock times into instants and pay.
 * - End time at or before start time means the shift finishes the next day.
 * - Duration uses elapsed time between instants (DST-correct), not wall-clock subtraction.
 * - Paid hours = duration − unpaid break; earnings = paid minutes × rate ÷ 60, rounded to the cent.
 */
export function computeShift(input: ShiftInput): Result<ShiftTimes> {
  const date = parseDateKey(input.date);
  if (!date.ok) return err(date.error);
  const start = parseTime(input.startTime);
  if (!start.ok) return err(`Start: ${start.error}`);
  const end = parseTime(input.endTime);
  if (!end.ok) return err(`Finish: ${end.error}`);
  if (start.value === end.value) return err('Start and finish times cannot be the same.');

  const brk = input.unpaidBreakMinutes;
  if (!Number.isInteger(brk) || brk < 0) return err('Unpaid break must be zero or more whole minutes.');
  try {
    assertCents(input.hourlyRateCents, 'Hourly rate');
  } catch (e) {
    return err((e as Error).message);
  }

  const overnight = end.value < start.value;
  const startAt = localDateTime(input.date, start.value).getTime();
  const endAt = localDateTime(overnight ? addDays(input.date, 1) : input.date, end.value).getTime();
  const durationMinutes = Math.round((endAt - startAt) / MINUTE_MS);

  if (durationMinutes <= 0) return err('Shift must finish after it starts.');
  if (durationMinutes > MAX_SHIFT_MINUTES) return err('Shifts longer than 16 hours are not supported.');
  if (brk >= durationMinutes) return err('Unpaid break must be shorter than the shift.');

  const paidMinutes = durationMinutes - brk;
  return ok({
    startAt,
    endAt,
    overnight,
    durationMinutes,
    paidMinutes,
    estimatedEarningsCents: earningsFor(paidMinutes, input.hourlyRateCents),
  });
}

/** Integer arithmetic: minutes × cents/hour ÷ 60, rounded half up. */
export function earningsFor(paidMinutes: number, hourlyRateCents: Cents): Cents {
  return Math.floor((paidMinutes * hourlyRateCents + 30) / 60);
}

export function paidMinutesOf(shift: { startAt: number; endAt: number; unpaidBreakMinutes: number }): number {
  return Math.max(0, Math.round((shift.endAt - shift.startAt) / MINUTE_MS) - shift.unpaidBreakMinutes);
}

export interface TimeSpan {
  startAt: number;
  endAt: number;
}

export function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

export type ShiftPhase = 'upcoming' | 'in_progress' | 'finished';

export function shiftPhase(shift: TimeSpan, now: number): ShiftPhase {
  if (now < shift.startAt) return 'upcoming';
  if (now < shift.endAt) return 'in_progress';
  return 'finished';
}
