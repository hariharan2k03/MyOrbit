import { expenseTotalsByCategory, totalExpenses, totalIncome } from '@/database/repositories/finance';
import type { AppSettings } from '@/database/repositories/settings';
import { listUpcomingAssessments } from '@/database/repositories/study';
import { listTasks } from '@/database/repositories/tasks';
import { listShiftsInRange, type Shift } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { loadCalendar } from '@/features/calendar/calendarData';
import { loadDashboard } from '@/features/dashboard/dashboardData';
import { takeHome } from '@/features/finance/auTax';
import { shiftPay } from '@/features/work/payRates';
import { paidMinutesOf } from '@/features/work/shiftMath';
import { formatCents } from '@/utils/money';
import { addDays, addMonths, formatClock, formatDateKey, formatDuration, formatTimeRange, localDateTime, monthLabel, monthRange, toDateKey, weekRange, type DateKey } from '@/utils/time';

/** Study suggestions only use free blocks inside these hours. */
const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 22 * 60;
const MIN_FREE_MIN = 45;

const active = (shifts: Shift[]) => shifts.filter((s) => s.status !== 'cancelled');
const gross = (shifts: Shift[]) => active(shifts).reduce((c, s) => c + shiftPay(s, s.rates).grossCents, 0);
const paid = (shifts: Shift[]) => active(shifts).reduce((m, s) => m + paidMinutesOf(s), 0);
const day = (k: DateKey) => formatDateKey(k, { weekday: true });

/**
 * Free blocks of at least 45 minutes between 8 AM and 10 PM, around shifts,
 * classes and other timed items. Exported for tests.
 */
export function freeBlocks(busy: { startAt: number; endAt: number }[], date: DateKey, now: number): { startAt: number; endAt: number }[] {
  let cursor = Math.max(localDateTime(date, DAY_START_MIN).getTime(), now);
  // Round up to the next half hour so suggestions start at a sensible time.
  cursor = Math.ceil(cursor / 1_800_000) * 1_800_000;
  const end = localDateTime(date, DAY_END_MIN).getTime();
  const out: { startAt: number; endAt: number }[] = [];
  for (const b of [...busy].sort((a, c) => a.startAt - c.startAt)) {
    if (b.endAt <= cursor) continue;
    if (b.startAt >= end) break;
    if (b.startAt - cursor >= MIN_FREE_MIN * 60_000) out.push({ startAt: cursor, endAt: Math.min(b.startAt, end) });
    cursor = Math.max(cursor, b.endAt);
  }
  if (end - cursor >= MIN_FREE_MIN * 60_000) out.push({ startAt: cursor, endAt: end });
  return out;
}

/**
 * A plain-text summary of the user's own data, computed exactly in SQLite and
 * JS. The on-device model is told to answer only from these lines, so totals
 * and dates are never invented by the model.
 */
export async function buildFacts(db: SqlDb, settings: Pick<AppSettings, 'taxResidency'>, now = Date.now()): Promise<string> {
  const today = toDateKey(new Date(now));
  const week = weekRange(today);
  const month = monthRange(today);
  const lastMonth = monthRange(addMonths(today, -1));
  const [dash, weekShifts, monthShifts, lastMonthShifts, upcoming, cats, lastMonthSpent, lastMonthIncome, assessments, openTasks, cal] = await Promise.all([
    loadDashboard(db, now),
    listShiftsInRange(db, week),
    listShiftsInRange(db, month),
    listShiftsInRange(db, lastMonth),
    listShiftsInRange(db, { start: today, end: addDays(today, 15) }),
    expenseTotalsByCategory(db, month),
    totalExpenses(db, lastMonth),
    totalIncome(db, lastMonth),
    listUpcomingAssessments(db, now, 6),
    listTasks(db, { status: 'open' }),
    loadCalendar(db, { start: today, end: addDays(today, 2) }),
  ]);

  const lines: string[] = [];
  lines.push(`Today is ${day(today)} ${new Date(now).getFullYear()}, ${formatClock(now)}. Money is in Australian dollars.`);

  const period = (label: string, shifts: Shift[], perYear: number) => {
    const g = gross(shifts);
    const n = active(shifts).length;
    if (n === 0) return `- ${label}: no shifts.`;
    const net = takeHome(g, perYear, settings.taxResidency).netCents;
    return `- ${label}: ${n} ${n === 1 ? 'shift' : 'shifts'}, ${formatDuration(paid(shifts))} paid, earned ${formatCents(g)} before tax, about ${formatCents(net)} after tax (estimate).`;
  };
  lines.push('', 'WORK');
  // Ranges have an exclusive end, so the week's last day is the day before week.end.
  lines.push(period(`This week (${day(week.start)} – ${day(addDays(week.end, -1))})`, weekShifts, 52));
  lines.push(period(`This month (${monthLabel(today)})`, monthShifts, 12));
  lines.push(period(`Last month (${monthLabel(lastMonth.start)})`, lastMonthShifts, 12));
  const next = active(upcoming).filter((s) => s.endAt > now).slice(0, 5);
  lines.push(next.length ? `- Upcoming shifts: ${next.map((s) => `${day(s.shiftDate)} ${formatTimeRange(s.startAt, s.endAt)} at ${s.workplaceName} (${formatCents(shiftPay(s, s.rates).grossCents)})`).join('; ')}.` : '- No shifts in the next two weeks.');

  lines.push('', `MONEY (${monthLabel(today)})`);
  lines.push(`- Income recorded: ${formatCents(dash.monthIncomeCents)}. Spent: ${formatCents(dash.monthExpenseCents)}.`);
  if (dash.budget) {
    const b = dash.budget;
    lines.push(`- Budget ${formatCents(b.limitCents)}: ${b.remainingCents >= 0 ? `${formatCents(b.remainingCents)} left` : `${formatCents(-b.remainingCents)} over`}.`);
  } else lines.push('- No monthly budget set.');
  const top = [...cats].sort((a, b) => b.totalCents - a.totalCents).filter((c) => c.totalCents > 0).slice(0, 6);
  if (top.length) lines.push(`- Spending by category: ${top.map((c) => `${c.name} ${formatCents(c.totalCents)}`).join(', ')}.`);
  lines.push(`- Last month: income ${formatCents(lastMonthIncome)}, spent ${formatCents(lastMonthSpent)}.`);

  lines.push('', 'STUDY');
  const due = assessments.filter((a) => a.dueAt !== null && a.status === 'pending');
  lines.push(due.length ? `- Due soon: ${due.map((a) => `${a.title} (${a.subjectName}, worth ${a.weightBp / 100}%) due ${day(toDateKey(new Date(a.dueAt!)))} ${formatClock(a.dueAt!)}`).join('; ')}.` : '- No assessments due soon.');
  lines.push(`- Studied this week: ${formatDuration(dash.studyWeekMinutes)}${dash.studyWeekGoalMinutes ? ` of a ${formatDuration(dash.studyWeekGoalMinutes)} goal` : ''}.`);

  lines.push('', 'TASKS');
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = openTasks.filter((t) => t.dueDate === today);
  const thisWeek = openTasks.filter((t) => t.dueDate && t.dueDate > today && t.dueDate < week.end);
  const list = (ts: typeof openTasks) => ts.slice(0, 8).map((t) => t.title).join('; ');
  lines.push(`- Overdue: ${overdue.length ? list(overdue) : 'none'}.`);
  lines.push(`- Due today: ${dueToday.length ? list(dueToday) : 'none'}.`);
  lines.push(`- Due later this week: ${thisWeek.length ? thisWeek.slice(0, 8).map((t) => `${t.title} (${day(t.dueDate!)})`).join('; ') : 'none'}.`);

  lines.push('', 'HABITS');
  lines.push(dash.habitsTotal ? `- Done today: ${dash.habitsDone} of ${dash.habitsTotal}.` : '- No habits set up.');

  lines.push('', 'FREE TIME (for planning study)');
  for (const d of [today, addDays(today, 1)]) {
    const busy = (cal.get(d) ?? []).filter((i) => i.startAt !== null && i.endAt !== null && !i.allDay).map((i) => ({ startAt: i.startAt!, endAt: i.endAt! }));
    const blocks = freeBlocks(busy, d, now);
    lines.push(`- ${d === today ? 'Today' : 'Tomorrow'}: ${blocks.length ? blocks.map((b) => formatTimeRange(b.startAt, b.endAt)).join(', ') : 'no free blocks'}.`);
  }
  return lines.join('\n');
}

export const ASSISTANT_INSTRUCTIONS = `You are MyOrbit's private assistant, running on the user's iPhone.
Answer using ONLY the facts below. Quote the numbers and dates exactly as written; do not do your own maths or estimate.
If the facts don't cover the question, say you don't have that information in MyOrbit.
Be warm, clear and brief: at most 4 short sentences or a short list. Use 12-hour times and $ amounts as given.
Tax figures are estimates; say so if you mention after-tax pay.`;
