import type { AppSettings } from '@/database/repositories/settings';
import type { SqlDb } from '@/database/types';
import { loadCalendar } from '@/features/calendar/calendarData';
import { loadDashboard } from '@/features/dashboard/dashboardData';
import { applyIntentActions } from '@/features/intents/intentActions';
import { formatCents } from '@/utils/money';
import { addDays, formatClock, formatDateKey, formatTimeRange, toDateKey } from '@/utils/time';
import type { TodayWidgetProps } from '@/widgets/TodayWidget';

const KIND_COLORS: Record<string, string> = { shift: '#22D3EE', assessment: '#60A5FA', study: '#A3E635', task: '#4ADE80', event: '#5AA2FF' };

/** Builds the widget snapshot from real data. Exported for tests. */
export async function buildTodayWidgetProps(db: SqlDb, settings: Pick<AppSettings, 'hideAmountsInWidgets'>, now = Date.now()): Promise<TodayWidgetProps> {
  const today = toDateKey(new Date(now));
  const [dash, byDay] = await Promise.all([loadDashboard(db, now), loadCalendar(db, { start: today, end: addDays(today, 1) })]);
  const items = (byDay.get(today) ?? []).filter((i) => !i.done);
  // "Next" = the first timed item that hasn't ended yet; otherwise the first untimed one.
  const upcoming = items.filter((i) => i.startAt !== null && (i.endAt ?? i.startAt) > now);
  const next = upcoming[0] ?? items.find((i) => i.startAt === null) ?? null;
  return {
    dateLabel: formatDateKey(today, { weekday: true }),
    nextTitle: next?.title ?? '',
    nextTime: next?.startAt ? (next.endAt ? formatTimeRange(next.startAt, next.endAt) : formatClock(next.startAt)) : next ? 'Today' : '',
    nextColor: next ? (next.color ?? KIND_COLORS[next.kind] ?? '#5AA2FF') : '#5AA2FF',
    tasksLeft: dash.tasksDueToday.length,
    tasks: dash.tasksDueToday.slice(0, 4).map((t) => ({ id: t.id, title: t.title })),
    doneTaskIds: [],
    habitsDone: dash.habitsDone,
    habitsTotal: dash.habitsTotal,
    agenda: upcoming.slice(next && next.startAt ? 1 : 0, 7).map((i) => ({
      time: i.startAt && i.endAt ? formatTimeRange(i.startAt, i.endAt) : i.startAt ? formatClock(i.startAt) : 'Today',
      title: i.title,
      color: i.color ?? KIND_COLORS[i.kind] ?? '#5AA2FF',
    })),
    moneyLine: settings.hideAmountsInWidgets
      ? ''
      : `Spent ${formatCents(dash.monthExpenseCents, { showCents: false })} this month${dash.budget ? ` · ${formatCents(Math.max(0, dash.budget.remainingCents), { showCents: false })} left` : ''}`,
    updated: formatClock(now),
  };
}

/**
 * Pushes a fresh snapshot to the WidgetKit extension. Called after data
 * changes; WidgetKit decides when the Home Screen actually redraws.
 */
/** Task ids ticked in the widget but not yet completed in the database. Exported for tests. */
export function tickedTaskIds(entries: { props: object }[]): number[] {
  const ids = new Set<number>();
  for (const e of entries) {
    const done = (e.props as Partial<TodayWidgetProps>).doneTaskIds;
    if (Array.isArray(done)) for (const id of done) if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * Completes tasks ticked in the widget, then pushes a fresh snapshot to the
 * WidgetKit extension. Returns how many tasks were completed, so the caller
 * can refresh open screens. WidgetKit decides when the Home Screen redraws.
 */
export async function refreshWidgets(db: SqlDb, settings: Pick<AppSettings, 'hideAmountsInWidgets'>): Promise<number> {
  try {
    // Loaded lazily so a widget-extension problem can never stop the app from starting.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TodayWidget = (require('@/widgets/TodayWidget') as typeof import('@/widgets/TodayWidget')).default;
    const ticked = tickedTaskIds(await TodayWidget.getTimeline());
    if (ticked.length > 0) {
      await applyIntentActions(db, ticked.map((taskId) => ({ type: 'completeTask' as const, taskId })), toDateKey(new Date()));
    }
    TodayWidget.updateSnapshot(await buildTodayWidgetProps(db, settings));
    return ticked.length;
  } catch (e) {
    // Widgets are optional (e.g. not supported in this build); the app keeps working.
    console.warn('Widget refresh failed', e);
    return 0;
  }
}
