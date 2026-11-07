import { addDays, diffDays, startOfWeek, type DateKey } from '@/utils/time';

export type HabitFrequency = 'daily' | 'weekly';

export interface HabitStats {
  currentStreak: number;
  longestStreak: number;
  /** Completions in the current period (today, or this week). */
  periodCount: number;
  periodTarget: number;
  periodDone: boolean;
}

/**
 * Streaks are counted on local date keys, so timezone/DST changes never
 * split or merge days. For daily habits an unfinished *today* doesn't break
 * the streak — it only breaks once a full day is missed.
 * Weekly habits count consecutive weeks meeting the target.
 */
export function habitStats(
  logs: readonly DateKey[],
  frequency: HabitFrequency,
  target: number,
  today: DateKey,
): HabitStats {
  const days = new Set(logs);
  if (frequency === 'daily') return dailyStats(days, today);
  return weeklyStats(logs, Math.max(1, target), today);
}

/** Daily habits are done-or-not per day (one log per day is enforced in the DB). */
function dailyStats(days: Set<DateKey>, today: DateKey): HabitStats {
  const doneToday = days.has(today);
  let current = 0;
  for (let k = doneToday ? today : addDays(today, -1); days.has(k); k = addDays(k, -1)) current++;

  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev: DateKey | null = null;
  for (const k of sorted) {
    run = prev !== null && diffDays(prev, k) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return {
    currentStreak: current,
    longestStreak: longest,
    periodCount: doneToday ? 1 : 0,
    periodTarget: 1,
    periodDone: doneToday,
  };
}

function weeklyStats(logs: readonly DateKey[], target: number, today: DateKey): HabitStats {
  const perWeek = new Map<DateKey, number>();
  for (const k of new Set(logs)) {
    const w = startOfWeek(k);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  const thisWeek = startOfWeek(today);
  const periodCount = perWeek.get(thisWeek) ?? 0;
  const met = (w: DateKey) => (perWeek.get(w) ?? 0) >= target;

  let current = 0;
  for (let w = met(thisWeek) ? thisWeek : addDays(thisWeek, -7); met(w); w = addDays(w, -7)) current++;

  const weeks = [...perWeek.keys()].filter(met).sort();
  let longest = 0;
  let run = 0;
  let prev: DateKey | null = null;
  for (const w of weeks) {
    run = prev !== null && diffDays(prev, w) === 7 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = w;
  }
  return { currentStreak: current, longestStreak: longest, periodCount, periodTarget: target, periodDone: periodCount >= target };
}
