import { listStudySessions } from '@/database/repositories/study';
import { listHabitsWithStats } from '@/database/repositories/tasks';
import { listShiftsInRange } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { paidMinutesOf } from '@/features/work/shiftMath';
import { addDays, dateFromKey, toDateKey, weekRange, type DateRange } from '@/utils/time';

export interface InsightsData {
  week: DateRange;
  workMinutes: number;
  studyMinutes: number;
  tasksDone: number;
  tasksDoneLastWeek: number;
  bestStreak: { name: string; days: number; unit: 'day' | 'week' } | null;
  habitsDoneToday: number;
  habitsTotal: number;
  /** Distinct days in the last 30 with any logged activity (shift, study, task or habit). */
  activeDays30: number;
}

async function tasksCompletedIn(db: SqlDb, range: DateRange): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE completed_at >= ? AND completed_at < ?', [
    dateFromKey(range.start).getTime(),
    dateFromKey(range.end).getTime(),
  ]);
  return r?.n ?? 0;
}

/** Real weekly stats only — every number here is computed from stored records. */
export async function loadInsights(db: SqlDb, now = Date.now()): Promise<InsightsData> {
  const today = toDateKey(new Date(now));
  const week = weekRange(today);
  const lastWeek = weekRange(addDays(today, -7));
  const last30 = { start: addDays(today, -29), end: addDays(today, 1) };
  const [shifts, sessions, tasksDone, tasksDoneLastWeek, habits, activity] = await Promise.all([
    listShiftsInRange(db, week),
    listStudySessions(db, week),
    tasksCompletedIn(db, week),
    tasksCompletedIn(db, lastWeek),
    listHabitsWithStats(db, today),
    db.getAllAsync<{ d: string }>(
      `SELECT shift_date AS d FROM work_shifts WHERE status != 'cancelled' AND shift_date >= ? AND shift_date < ?
       UNION SELECT session_date FROM study_sessions WHERE session_date >= ? AND session_date < ?
       UNION SELECT log_date FROM habit_logs WHERE log_date >= ? AND log_date < ?`,
      [last30.start, last30.end, last30.start, last30.end, last30.start, last30.end],
    ),
  ]);
  const taskDays = await db.getAllAsync<{ completed_at: number }>('SELECT completed_at FROM tasks WHERE completed_at >= ?', [
    dateFromKey(last30.start).getTime(),
  ]);
  const active = new Set(activity.map((a) => a.d));
  taskDays.forEach((t) => active.add(toDateKey(new Date(t.completed_at))));

  const best = habits.reduce<InsightsData['bestStreak']>((acc, h) => {
    if (h.stats.currentStreak === 0) return acc;
    if (!acc || h.stats.currentStreak > acc.days) return { name: h.name, days: h.stats.currentStreak, unit: h.frequency === 'daily' ? 'day' : 'week' };
    return acc;
  }, null);

  return {
    week,
    workMinutes: shifts.filter((s) => s.status !== 'cancelled').reduce((m, s) => m + paidMinutesOf(s), 0),
    studyMinutes: sessions.filter((s) => s.endedAt !== null).reduce((m, s) => m + Math.round((s.endedAt! - s.startedAt) / 60_000), 0),
    tasksDone,
    tasksDoneLastWeek,
    bestStreak: best,
    habitsDoneToday: habits.filter((h) => h.doneToday).length,
    habitsTotal: habits.length,
    activeDays30: active.size,
  };
}
