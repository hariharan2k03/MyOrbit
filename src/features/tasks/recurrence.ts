import { addDays, addMonths, type DateKey } from '@/utils/time';

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export const RECURRENCES: readonly Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

/**
 * Next due date after completing a recurring task. Advances from the original
 * due date (not "today") so the schedule doesn't drift, but skips forward past
 * `today` so overdue recurring tasks don't spawn a backlog.
 */
export function nextDueDate(due: DateKey, rule: Recurrence, today: DateKey): DateKey | null {
  if (rule === 'none') return null;
  // Always step from the original date so monthly clamping (31st → 28th) doesn't stick.
  const step = (n: number) =>
    rule === 'daily' ? addDays(due, n) : rule === 'weekly' ? addDays(due, 7 * n) : addMonths(due, n);
  let n = 1;
  let next = step(n);
  while (next <= today) next = step(++n);
  return next;
}
