import { habitStats, type HabitFrequency, type HabitStats } from '@/features/habits/streakMath';
import { nextDueDate, RECURRENCES, type Recurrence } from '@/features/tasks/recurrence';
import { unwrap, ValidationError } from '@/utils/result';
import { addDays, isValidDateKey, parseTime, type DateKey } from '@/utils/time';
import { cleanText, LIMITS } from '@/utils/validation';
import type { SqlDb, SqlValue } from '../types';

export const TASK_CATEGORIES = ['personal', 'work', 'study', 'home', 'health', 'finance'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type Priority = 1 | 2 | 3; // 1 = high

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  priority: Priority;
  category: TaskCategory;
  dueDate: DateKey | null;
  recurrence: Recurrence;
  completedAt: number | null;
}

export interface TaskInput {
  title: string;
  notes?: string | null;
  priority: Priority;
  category: TaskCategory;
  dueDate: DateKey | null;
  recurrence: Recurrence;
}

type TaskRow = {
  id: number;
  title: string;
  notes: string | null;
  priority: Priority;
  category: TaskCategory;
  due_date: string | null;
  recurrence: Recurrence;
  completed_at: number | null;
};

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  priority: r.priority,
  category: r.category,
  dueDate: r.due_date,
  recurrence: r.recurrence,
  completedAt: r.completed_at,
});

function cleanTask(input: TaskInput) {
  if (![1, 2, 3].includes(input.priority)) throw new ValidationError('Choose a priority.');
  if (!TASK_CATEGORIES.includes(input.category)) throw new ValidationError('Choose a category.');
  if (!RECURRENCES.includes(input.recurrence)) throw new ValidationError('Choose how often it repeats.');
  if (input.dueDate !== null && !isValidDateKey(input.dueDate)) throw new ValidationError('Due date is invalid.');
  if (input.recurrence !== 'none' && input.dueDate === null) throw new ValidationError('Repeating tasks need a due date.');
  return {
    title: unwrap(cleanText(input.title, 'Title', LIMITS.title, { required: true })),
    notes: unwrap(cleanText(input.notes, 'Notes', LIMITS.notes)) || null,
  };
}

export async function createTask(db: SqlDb, input: TaskInput): Promise<number> {
  const t = cleanTask(input);
  const now = Date.now();
  const r = await db.runAsync(
    `INSERT INTO tasks (title, notes, priority, category, due_date, recurrence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.title, t.notes, input.priority, input.category, input.dueDate, input.recurrence, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateTask(db: SqlDb, id: number, input: TaskInput): Promise<void> {
  const t = cleanTask(input);
  await db.runAsync(
    `UPDATE tasks SET title = ?, notes = ?, priority = ?, category = ?, due_date = ?, recurrence = ?, updated_at = ? WHERE id = ?`,
    [t.title, t.notes, input.priority, input.category, input.dueDate, input.recurrence, Date.now(), id],
  );
}

export async function deleteTask(db: SqlDb, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM reminders WHERE entity_type = 'task' AND entity_id = ?`, [id]);
    await db.runAsync('DELETE FROM tasks WHERE id = ?', [id]);
  });
}

/**
 * Completing a recurring task rolls its due date forward instead of closing
 * it, so there's always exactly one row per recurring task. Idempotent: a
 * second tap (e.g. from a widget and the app) doesn't double-advance.
 */
export async function completeTask(db: SqlDb, id: number, today: DateKey, now = Date.now()): Promise<void> {
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!row || row.completed_at !== null) return;
    const next = row.due_date ? nextDueDate(row.due_date, row.recurrence, today) : null;
    if (next) {
      await db.runAsync('UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?', [next, now, id]);
    } else {
      await db.runAsync('UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
    }
  });
}

export async function reopenTask(db: SqlDb, id: number): Promise<void> {
  await db.runAsync('UPDATE tasks SET completed_at = NULL, updated_at = ? WHERE id = ?', [Date.now(), id]);
}

export interface TaskFilter {
  status?: 'open' | 'done' | 'all';
  category?: TaskCategory | null;
  search?: string;
  dueOnOrBefore?: DateKey;
}

export async function listTasks(db: SqlDb, filter: TaskFilter = {}): Promise<Task[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  const status = filter.status ?? 'open';
  if (status === 'open') where.push('completed_at IS NULL');
  if (status === 'done') where.push('completed_at IS NOT NULL');
  if (filter.category) {
    where.push('category = ?');
    params.push(filter.category);
  }
  if (filter.dueOnOrBefore) {
    where.push('due_date IS NOT NULL AND due_date <= ?');
    params.push(filter.dueOnOrBefore);
  }
  const search = (filter.search ?? '').trim().slice(0, LIMITS.title);
  if (search) {
    where.push(`title LIKE ? ESCAPE '\\'`);
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const rows = await db.getAllAsync<TaskRow>(
    `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY completed_at IS NOT NULL, due_date IS NULL, due_date, priority, id LIMIT 500`,
    params,
  );
  return rows.map(toTask);
}

// ── Habits ──────────────────────────────────────────────────────────────────

export interface Habit {
  id: number;
  name: string;
  frequency: HabitFrequency;
  targetPerPeriod: number;
  reminderTime: string | null;
  color: string;
}

export interface HabitWithStats extends Habit {
  stats: HabitStats;
  doneToday: boolean;
}

export interface HabitInput {
  name: string;
  frequency: HabitFrequency;
  targetPerPeriod: number;
  reminderTime?: string | null;
  color?: string;
}

function cleanHabit(input: HabitInput) {
  if (input.frequency !== 'daily' && input.frequency !== 'weekly') throw new ValidationError('Choose daily or weekly.');
  const target = input.frequency === 'daily' ? 1 : input.targetPerPeriod;
  if (!Number.isInteger(target) || target < 1 || target > 7) throw new ValidationError('Weekly target must be 1–7 times.');
  const reminder = input.reminderTime?.trim() || null;
  if (reminder !== null && !parseTime(reminder).ok) throw new ValidationError('Reminder time must be HH:mm.');
  return {
    name: unwrap(cleanText(input.name, 'Habit name', LIMITS.name, { required: true })),
    target,
    reminder,
    color: /^#[0-9A-Fa-f]{6}$/.test(input.color ?? '') ? input.color! : '#4CC38A',
  };
}

export async function createHabit(db: SqlDb, input: HabitInput): Promise<number> {
  const h = cleanHabit(input);
  const now = Date.now();
  const r = await db.runAsync(
    `INSERT INTO habits (name, frequency, target_per_period, reminder_time, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [h.name, input.frequency, h.target, h.reminder, h.color, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateHabit(db: SqlDb, id: number, input: HabitInput): Promise<void> {
  const h = cleanHabit(input);
  await db.runAsync(
    `UPDATE habits SET name = ?, frequency = ?, target_per_period = ?, reminder_time = ?, color = ?, updated_at = ? WHERE id = ?`,
    [h.name, input.frequency, h.target, h.reminder, h.color, Date.now(), id],
  );
}

export async function deleteHabit(db: SqlDb, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM reminders WHERE entity_type = 'habit' AND entity_id = ?`, [id]);
    await db.runAsync('DELETE FROM habits WHERE id = ?', [id]);
  });
}

/** Toggles today's completion. UNIQUE(habit_id, log_date) prevents double logging. */
export async function toggleHabit(db: SqlDb, habitId: number, date: DateKey): Promise<boolean> {
  const del = await db.runAsync('DELETE FROM habit_logs WHERE habit_id = ? AND log_date = ?', [habitId, date]);
  if (del.changes > 0) return false;
  await db.runAsync('INSERT INTO habit_logs (habit_id, log_date, created_at) VALUES (?, ?, ?)', [habitId, date, Date.now()]);
  return true;
}

export async function listHabitsWithStats(db: SqlDb, today: DateKey): Promise<HabitWithStats[]> {
  const habits = await db.getAllAsync<{
    id: number;
    name: string;
    frequency: HabitFrequency;
    target_per_period: number;
    reminder_time: string | null;
    color: string;
  }>('SELECT * FROM habits WHERE archived = 0 ORDER BY created_at');
  // A year of history is enough for streaks shown in the app and keeps the query bounded.
  const logs = await db.getAllAsync<{ habit_id: number; log_date: string }>(
    'SELECT habit_id, log_date FROM habit_logs WHERE log_date > ?',
    [addDays(today, -400)],
  );
  const byHabit = new Map<number, DateKey[]>();
  for (const l of logs) {
    const list = byHabit.get(l.habit_id) ?? [];
    list.push(l.log_date);
    byHabit.set(l.habit_id, list);
  }
  return habits.map((h) => {
    const days = byHabit.get(h.id) ?? [];
    return {
      id: h.id,
      name: h.name,
      frequency: h.frequency,
      targetPerPeriod: h.target_per_period,
      reminderTime: h.reminder_time,
      color: h.color,
      stats: habitStats(days, h.frequency, h.target_per_period, today),
      doneToday: days.includes(today),
    };
  });
}

export async function habitHistory(db: SqlDb, habitId: number, from: DateKey): Promise<DateKey[]> {
  const rows = await db.getAllAsync<{ log_date: string }>(
    'SELECT log_date FROM habit_logs WHERE habit_id = ? AND log_date >= ? ORDER BY log_date',
    [habitId, from],
  );
  return rows.map((r) => r.log_date);
}
