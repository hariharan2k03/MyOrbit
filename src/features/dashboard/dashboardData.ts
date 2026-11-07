import { getActiveActivitySession, type ActivitySession } from '@/database/repositories/activities';
import { listBudgets, totalExpenses, totalIncome } from '@/database/repositories/finance';
import { listStudySessions, listSubjects, listUpcomingAssessments, type Assessment } from '@/database/repositories/study';
import { listHabitsWithStats, listTasks, type Task } from '@/database/repositories/tasks';
import { listShiftsInRange, listUpcomingShifts, type Shift } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { loadCalendar } from '@/features/calendar/calendarData';
import { budgetStatus, type BudgetStatus } from '@/features/finance/budgetMath';
import { shiftPay } from '@/features/work/payRates';
import { paidMinutesOf } from '@/features/work/shiftMath';
import type { Cents } from '@/utils/money';
import { addDays, customMonthRange, dateFromKey, eachDay, monthRange, toDateKey, weekRange, type DateKey } from '@/utils/time';

/** Days shown before today in the Home date strip. */
export const STRIP_DAYS_BEFORE = 3;

export interface AgendaItem {
  key: string;
  kind: 'shift' | 'assessment' | 'task' | 'study';
  title: string;
  subtitle: string;
  at: number | null;
  href: string;
}

export interface DayProductivity {
  date: DateKey;
  workMinutes: number;
  studyMinutes: number;
  tasksDone: number;
}

export interface DashboardData {
  today: DateKey;
  agenda: AgendaItem[];
  upcomingShifts: Shift[];
  nextAssessment: Assessment | null;
  tasksDueToday: Task[];
  openTaskCount: number;
  monthIncomeCents: Cents;
  monthExpenseCents: Cents;
  weekEstimatedEarningsCents: Cents;
  budget: BudgetStatus | null;
  studyWeekMinutes: number;
  studyWeekGoalMinutes: number;
  habitsDone: number;
  habitsTotal: number;
  week: DayProductivity[];
  activeSession: ActivitySession | null;
  subjectCount: number;
  studyTodayMinutes: number;
  /** Three days back to 30 days ahead, with how many items each has (for the scrolling date strip). */
  days: { date: DateKey; count: number }[];
}

/** One pass over SQLite for everything the Home tab shows. All values are real stored data. */
export async function loadDashboard(db: SqlDb, now = Date.now()): Promise<DashboardData> {
  const today = toDateKey(new Date(now));
  const week = weekRange(today);
  const month = monthRange(today);

  const stripRange = { start: addDays(today, -STRIP_DAYS_BEFORE), end: addDays(today, 31) };
  const [shiftsWeek, upcomingShifts, assessments, openTasks, habits, budgets, subjects, sessions, activeSession] = await Promise.all([
    listShiftsInRange(db, week),
    listUpcomingShifts(db, now, 3),
    listUpcomingAssessments(db, now, 5),
    listTasks(db, { status: 'open' }),
    listHabitsWithStats(db, today),
    listBudgets(db),
    listSubjects(db),
    listStudySessions(db, week),
    getActiveActivitySession(db, now),
  ]);
  const byDay = await loadCalendar(db, stripRange);

  const overall = budgets.find((b) => b.categoryId === null) ?? null;
  const budgetRange = overall ? customMonthRange(today, overall.periodStartDay) : month;
  const [monthIncomeCents, monthExpenseCents, budgetSpent] = await Promise.all([
    totalIncome(db, month),
    totalExpenses(db, month),
    overall ? totalExpenses(db, budgetRange) : Promise.resolve(0),
  ]);

  const doneThisWeek = await db.getAllAsync<{ completed_at: number }>(
    'SELECT completed_at FROM tasks WHERE completed_at >= ? AND completed_at < ?',
    [dateFromKey(week.start).getTime(), dateFromKey(week.end).getTime()],
  );

  const activeShifts = shiftsWeek.filter((s) => s.status !== 'cancelled');
  const tasksDueToday = openTasks.filter((t) => t.dueDate !== null && t.dueDate <= today);

  const agenda: AgendaItem[] = [
    ...activeShifts
      .filter((s) => s.shiftDate === today)
      .map<AgendaItem>((s) => ({
        key: `shift-${s.id}`,
        kind: 'shift',
        title: s.workplaceName,
        subtitle: 'Work shift',
        at: s.startAt,
        href: `/shift/${s.id}`,
      })),
    ...assessments
      .filter((a) => a.dueAt !== null && toDateKey(new Date(a.dueAt)) === today)
      .map<AgendaItem>((a) => ({
        key: `assessment-${a.id}`,
        kind: 'assessment',
        title: a.title,
        subtitle: `${a.subjectName} · due`,
        at: a.dueAt,
        href: `/assessment/${a.id}`,
      })),
    ...sessions
      .filter((s) => s.sessionDate === today)
      .map<AgendaItem>((s) => ({
        key: `study-${s.id}`,
        kind: 'study',
        title: s.subjectName,
        subtitle: `Study · ${s.plannedMinutes} min`,
        at: s.startedAt,
        href: `/subject-detail/${s.subjectId}`,
      })),
    ...tasksDueToday.slice(0, 5).map<AgendaItem>((t) => ({
      key: `task-${t.id}`,
      kind: 'task',
      title: t.title,
      subtitle: t.dueDate! < today ? 'Overdue task' : 'Task',
      at: null,
      href: `/task/${t.id}`,
    })),
  ].sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER));

  const days = eachDay(week).map<DayProductivity>((date) => ({
    date,
    workMinutes: activeShifts.filter((s) => s.shiftDate === date).reduce((m, s) => m + paidMinutesOf(s), 0),
    studyMinutes: sessions
      .filter((s) => s.sessionDate === date && s.endedAt !== null)
      .reduce((m, s) => m + Math.round((s.endedAt! - s.startedAt) / 60_000), 0),
    tasksDone: doneThisWeek.filter((t) => toDateKey(new Date(t.completed_at)) === date).length,
  }));

  return {
    today,
    agenda,
    upcomingShifts,
    nextAssessment: assessments[0] ?? null,
    tasksDueToday,
    openTaskCount: openTasks.length,
    monthIncomeCents,
    monthExpenseCents,
    weekEstimatedEarningsCents: activeShifts.reduce((c, s) => c + shiftPay(s, s.rates).grossCents, 0),
    budget: overall ? budgetStatus(overall.limitCents, budgetSpent) : null,
    studyWeekMinutes: days.reduce((m, d) => m + d.studyMinutes, 0),
    studyWeekGoalMinutes: subjects.reduce((m, s) => m + s.weeklyGoalMinutes, 0),
    habitsDone: habits.filter((h) => (h.frequency === 'daily' ? h.doneToday : h.stats.periodDone)).length,
    habitsTotal: habits.length,
    week: days,
    activeSession,
    subjectCount: subjects.length,
    studyTodayMinutes: days.find((d) => d.date === today)?.studyMinutes ?? 0,
    days: eachDay(stripRange).map((date) => ({ date, count: (byDay.get(date) ?? []).filter((i) => !i.done).length })),
  };
}

export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
