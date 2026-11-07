import { listAssessments, listStudySessions } from '@/database/repositories/study';
import { listTasks } from '@/database/repositories/tasks';
import { listShiftsInRange } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { dateFromKey, isInRange, toDateKey, type DateKey, type DateRange } from '@/utils/time';

export type CalendarKind = 'shift' | 'assessment' | 'study' | 'task' | 'event';

export interface CalendarItem {
  key: string;
  kind: CalendarKind;
  date: DateKey;
  title: string;
  subtitle: string;
  startAt: number | null;
  endAt: number | null;
  href: string;
  done: boolean;
  /** Explicit colour (subscribed calendars use their feed colour). */
  color?: string;
  location?: string | null;
  allDay?: boolean;
}

/**
 * The calendar is a read-only view over the other modules' tables — nothing
 * is copied into a separate events table, so it can never drift or duplicate.
 */
export async function loadCalendar(db: SqlDb, range: DateRange): Promise<Map<DateKey, CalendarItem[]>> {
  const startMs = dateFromKey(range.start).getTime();
  const endMs = dateFromKey(range.end).getTime();
  const [shifts, assessments, sessions, tasks, feedEvents] = await Promise.all([
    listShiftsInRange(db, range),
    listAssessments(db),
    listStudySessions(db, range),
    listTasks(db, { status: 'all' }),
    db.getAllAsync<{ id: number; title: string; event_date: string; start_at: number; end_at: number; all_day: number; location: string | null; feed_name: string; color: string }>(
      `SELECT e.id, e.title, e.event_date, e.start_at, e.end_at, e.all_day, e.location, f.name AS feed_name, f.color
       FROM events e JOIN calendar_feeds f ON f.id = e.feed_id
       WHERE e.start_at < ? AND e.end_at > ? ORDER BY e.start_at`,
      [endMs, startMs],
    ),
  ]);

  const items: CalendarItem[] = [
    ...shifts
      .filter((s) => s.status !== 'cancelled')
      .map<CalendarItem>((s) => ({
        key: `shift-${s.id}`,
        kind: 'shift',
        date: s.shiftDate,
        title: s.workplaceName,
        subtitle: 'Work shift',
        startAt: s.startAt,
        endAt: s.endAt,
        href: `/shift/${s.id}`,
        done: s.status === 'completed',
      })),
    ...assessments
      .filter((a) => a.dueAt !== null && a.dueAt >= startMs && a.dueAt < endMs)
      .map<CalendarItem>((a) => ({
        key: `assessment-${a.id}`,
        kind: 'assessment',
        date: toDateKey(new Date(a.dueAt!)),
        title: a.title,
        subtitle: `${a.subjectName} · ${a.weightBp / 100}%`,
        startAt: a.dueAt,
        endAt: null,
        href: `/assessment/${a.id}`,
        done: a.status !== 'pending',
      })),
    ...sessions.map<CalendarItem>((s) => ({
      key: `study-${s.id}`,
      kind: 'study',
      date: s.sessionDate,
      title: s.subjectName,
      subtitle: 'Study session',
      startAt: s.startedAt,
      endAt: s.endedAt,
      href: `/subject-detail/${s.subjectId}`,
      done: s.endedAt !== null,
    })),
    ...tasks
      .filter((t) => t.dueDate !== null && isInRange(t.dueDate, range))
      .map<CalendarItem>((t) => ({
        key: `task-${t.id}`,
        kind: 'task',
        date: t.dueDate!,
        title: t.title,
        subtitle: 'Task',
        startAt: null,
        endAt: null,
        href: `/task/${t.id}`,
        done: t.completedAt !== null,
      })),
    ...feedEvents.map<CalendarItem>((e) => ({
      key: `event-${e.id}`,
      kind: 'event',
      date: e.event_date,
      title: e.title,
      subtitle: [e.location, e.feed_name].filter(Boolean).join(' · '),
      startAt: e.all_day ? null : e.start_at,
      endAt: e.all_day ? null : e.end_at,
      href: '/calendar-feeds',
      done: false,
      color: e.color,
      location: e.location,
      allDay: e.all_day === 1,
    })),
  ];

  const byDay = new Map<DateKey, CalendarItem[]>();
  for (const item of items) {
    const list = byDay.get(item.date) ?? [];
    list.push(item);
    byDay.set(item.date, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.startAt ?? Number.MAX_SAFE_INTEGER) - (b.startAt ?? Number.MAX_SAFE_INTEGER));
  }
  return byDay;
}
