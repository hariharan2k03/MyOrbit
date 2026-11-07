import type { AppSettings } from '@/database/repositories/settings';
import { listUpcomingShifts } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { addDays, formatClock, formatTimeRange, localDateTime, parseTime, toDateKey } from '@/utils/time';

export type ReminderEntity = 'shift' | 'assessment' | 'task' | 'habit';

export interface PlannedReminder {
  entityType: ReminderEntity;
  entityId: number;
  kind: string;
  /** First delivery (epoch ms). For a daily reminder, the next occurrence. */
  fireAt: number;
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** Repeats every day at this time instead of firing once. */
  daily?: { hour: number; minute: number };
}

/** How far ahead one-off reminders are scheduled; the app re-plans on every launch and data change. */
export const HORIZON_DAYS = 14;
/** iOS keeps at most 64 pending notifications per app; stay under it. */
export const MAX_REMINDERS = 60;
const MORNING_MIN = 9 * 60;

/** "15 minutes", "1 hour", "2 hours" — reads better in a notification than "1h". */
export function leadLabel(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const h = minutes / 60;
  return h === 1 ? '1 hour' : `${h} hours`;
}

type Prefs = Pick<AppSettings, 'notificationsEnabled' | 'shiftReminderMinutes' | 'remindAssessments' | 'remindTasks' | 'remindHabits' | 'habitReminderTime'>;

/**
 * Works out every reminder that should be pending right now, from the data.
 * Pure apart from reading SQLite, so it's tested directly; reminderSync.ts
 * hands the result to iOS.
 */
export async function planReminders(db: SqlDb, prefs: Prefs, now = Date.now()): Promise<PlannedReminder[]> {
  if (!prefs.notificationsEnabled) return [];
  const until = now + HORIZON_DAYS * 86_400_000;
  const out: PlannedReminder[] = [];

  {
    for (const s of await listUpcomingShifts(db, now, MAX_REMINDERS)) {
      // A shift's own setting wins; null means "use the default", 0 means "no reminder".
      const minutes = s.reminderMinutes ?? prefs.shiftReminderMinutes;
      if (minutes <= 0) continue;
      const fireAt = s.startAt - minutes * 60_000;
      if (fireAt <= now || s.startAt > until) continue;
      out.push({
        entityType: 'shift',
        entityId: s.id,
        kind: 'before',
        fireAt,
        title: `Shift in ${leadLabel(minutes)}`,
        body: `${s.workplaceName} · ${formatTimeRange(s.startAt, s.endAt)}`,
        url: 'daypilot://work',
      });
    }
  }

  if (prefs.remindAssessments) {
    const rows = await db.getAllAsync<{ id: number; title: string; due_at: number; subject: string }>(
      `SELECT a.id, a.title, a.due_at, COALESCE(s.code, s.name) AS subject
       FROM assessments a JOIN subjects s ON s.id = a.subject_id
       WHERE a.status = 'pending' AND a.due_at > ? AND a.due_at <= ? ORDER BY a.due_at`,
      [now, until],
    );
    for (const a of rows) {
      const dayBefore = localDateTime(addDays(toDateKey(new Date(a.due_at)), -1), MORNING_MIN).getTime();
      if (dayBefore > now) {
        out.push({ entityType: 'assessment', entityId: a.id, kind: 'day_before', fireAt: dayBefore, title: `Due tomorrow: ${a.title}`, body: `${a.subject} · ${formatClock(a.due_at)}`, url: 'daypilot://study' });
      }
      const twoHours = a.due_at - 2 * 3_600_000;
      if (twoHours > now) {
        out.push({ entityType: 'assessment', entityId: a.id, kind: 'two_hours', fireAt: twoHours, title: `Due in 2 hours: ${a.title}`, body: `${a.subject} · ${formatClock(a.due_at)}`, url: 'daypilot://study' });
      }
    }
  }

  if (prefs.remindTasks) {
    const today = toDateKey(new Date(now));
    const rows = await db.getAllAsync<{ id: number; title: string; due_date: string }>(
      `SELECT id, title, due_date FROM tasks WHERE completed_at IS NULL AND due_date >= ? AND due_date <= ? ORDER BY due_date`,
      [today, addDays(today, HORIZON_DAYS)],
    );
    for (const t of rows) {
      const fireAt = localDateTime(t.due_date, MORNING_MIN).getTime();
      if (fireAt <= now) continue;
      out.push({ entityType: 'task', entityId: t.id, kind: 'due', fireAt, title: 'Task due today', body: t.title, url: 'daypilot://tasks' });
    }
  }

  out.sort((a, b) => a.fireAt - b.fireAt);
  const oneOff = out.slice(0, prefs.remindHabits ? MAX_REMINDERS - 1 : MAX_REMINDERS);

  if (prefs.remindHabits) {
    const time = parseTime(prefs.habitReminderTime);
    const active = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM habits WHERE archived = 0');
    if (time.ok && (active?.n ?? 0) > 0) {
      const today = toDateKey(new Date(now));
      let next = localDateTime(today, time.value).getTime();
      if (next <= now) next = localDateTime(addDays(today, 1), time.value).getTime();
      oneOff.push({
        entityType: 'habit',
        entityId: 0,
        kind: 'daily',
        fireAt: next,
        title: 'Habit check-in',
        body: 'Tick off today’s habits to keep your streaks going.',
        url: 'daypilot://habits',
        daily: { hour: Math.floor(time.value / 60), minute: time.value % 60 },
      });
    }
  }
  return oneOff;
}
