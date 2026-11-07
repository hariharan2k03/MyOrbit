import type { SqlDb } from './types';

export interface Migration {
  version: number;
  description: string;
  statements: string[];
}

/**
 * Append-only. Never edit a released migration — add a new one. Migrations
 * must only add or reshape; they never drop user data.
 *
 * Conventions: instants are INTEGER epoch ms (`*_at`), calendar dates are
 * TEXT `YYYY-MM-DD` (`*_date`), money is INTEGER cents (`*_cents`),
 * percentages are INTEGER basis points (`*_bp`).
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema',
    statements: [
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE workplaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
        default_rate_cents INTEGER NOT NULL CHECK (default_rate_cents >= 0),
        address TEXT,
        color TEXT NOT NULL DEFAULT '#5B8DEF',
        notes TEXT,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE work_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workplace_id INTEGER NOT NULL REFERENCES workplaces(id) ON DELETE RESTRICT,
        shift_date TEXT NOT NULL,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        unpaid_break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (unpaid_break_minutes >= 0),
        hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents >= 0),
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
        reminder_minutes INTEGER CHECK (reminder_minutes IS NULL OR reminder_minutes BETWEEN 0 AND 1440),
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (end_at > start_at),
        UNIQUE (workplace_id, start_at)
      )`,
      `CREATE INDEX idx_shifts_start ON work_shifts(start_at)`,
      `CREATE INDEX idx_shifts_date ON work_shifts(shift_date)`,

      `CREATE TABLE expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
      `INSERT INTO expense_categories (name, icon, color, is_system, sort_order) VALUES
        ('Rent', 'house.fill', '#7C8CF8', 1, 1),
        ('Groceries', 'cart.fill', '#4CC38A', 1, 2),
        ('Transport', 'tram.fill', '#F5A524', 1, 3),
        ('Electricity', 'bolt.fill', '#F7D154', 1, 4),
        ('Internet', 'wifi', '#38BDF8', 1, 5),
        ('Shopping', 'bag.fill', '#E879F9', 1, 6),
        ('Entertainment', 'film.fill', '#F87171', 1, 7),
        ('Education', 'book.fill', '#A78BFA', 1, 8),
        ('Other', 'ellipsis.circle.fill', '#94A3B8', 1, 9)`,

      `CREATE TABLE expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        spent_date TEXT NOT NULL,
        description TEXT NOT NULL,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_expenses_date ON expenses(spent_date)`,
      `CREATE INDEX idx_expenses_cat_date ON expenses(category_id, spent_date)`,

      `CREATE TABLE income (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        pay_date TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('wages', 'salary', 'freelance', 'scholarship', 'gift', 'refund', 'other')),
        source TEXT NOT NULL,
        workplace_id INTEGER REFERENCES workplaces(id) ON DELETE SET NULL,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_income_date ON income(pay_date)`,

      // category_id NULL = overall budget. A partial index makes the overall budget unique.
      `CREATE TABLE budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER UNIQUE REFERENCES expense_categories(id) ON DELETE CASCADE,
        limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
        period_start_day INTEGER NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX idx_budgets_overall ON budgets((category_id IS NULL)) WHERE category_id IS NULL`,

      `CREATE TABLE subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        color TEXT NOT NULL DEFAULT '#A78BFA',
        target_percent INTEGER CHECK (target_percent IS NULL OR target_percent BETWEEN 0 AND 100),
        weekly_goal_minutes INTEGER NOT NULL DEFAULT 0 CHECK (weekly_goal_minutes >= 0),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        due_at INTEGER,
        weight_bp INTEGER NOT NULL CHECK (weight_bp BETWEEN 0 AND 10000),
        mark_obtained REAL CHECK (mark_obtained IS NULL OR mark_obtained >= 0),
        mark_total REAL CHECK (mark_total IS NULL OR mark_total > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'marked')),
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (mark_obtained IS NULL OR mark_total IS NULL OR mark_obtained <= mark_total)
      )`,
      `CREATE INDEX idx_assessments_due ON assessments(due_at)`,
      `CREATE INDEX idx_assessments_subject ON assessments(subject_id)`,

      `CREATE TABLE study_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
        session_date TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        planned_minutes INTEGER NOT NULL CHECK (planned_minutes BETWEEN 1 AND 600),
        notes TEXT,
        created_at INTEGER NOT NULL,
        CHECK (ended_at IS NULL OR ended_at >= started_at)
      )`,
      `CREATE INDEX idx_study_date ON study_sessions(session_date)`,

      `CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        notes TEXT,
        priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
        category TEXT NOT NULL DEFAULT 'personal' CHECK (category IN ('personal', 'work', 'study', 'home', 'health', 'finance')),
        due_date TEXT,
        recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_tasks_open_due ON tasks(completed_at, due_date)`,

      `CREATE TABLE habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
        target_per_period INTEGER NOT NULL DEFAULT 1 CHECK (target_per_period BETWEEN 1 AND 7),
        reminder_time TEXT,
        color TEXT NOT NULL DEFAULT '#4CC38A',
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE habit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        log_date TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (habit_id, log_date)
      )`,

      `CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        event_date TEXT NOT NULL,
        start_at INTEGER,
        end_at INTEGER,
        important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_events_date ON events(event_date)`,

      // One row per scheduled local notification, keyed to its source record so
      // rescheduling replaces instead of duplicating and restarts can reconcile.
      `CREATE TABLE reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('shift', 'assessment', 'task', 'habit', 'event', 'study')),
        entity_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'default',
        fire_at INTEGER NOT NULL,
        notification_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (entity_type, entity_id, kind)
      )`,

      // Persisted, time-based state for Live Activities. Countdowns are derived
      // from starts_at/ends_at, never from a running JS timer.
      `CREATE TABLE activity_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('work', 'study', 'focus', 'break')),
        title TEXT NOT NULL,
        subtitle TEXT,
        entity_type TEXT,
        entity_id INTEGER,
        starts_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
        native_activity_id TEXT,
        next_activity TEXT,
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        CHECK (ends_at > starts_at)
      )`,
      // At most one active session at a time (duplicate Live Activity prevention).
      `CREATE UNIQUE INDEX idx_activity_one_active ON activity_sessions(status) WHERE status = 'active'`,
    ],
  },
  {
    version: 2,
    description: 'Assessment kind (assignment, exam, quiz, other)',
    statements: [
      `ALTER TABLE assessments ADD COLUMN kind TEXT NOT NULL DEFAULT 'assignment'
        CHECK (kind IN ('assignment', 'exam', 'quiz', 'other'))`,
    ],
  },
  {
    version: 3,
    description: 'Penalty rates on workplaces; subscribed calendar feeds',
    statements: [
      `ALTER TABLE workplaces ADD COLUMN saturday_rate_cents INTEGER CHECK (saturday_rate_cents IS NULL OR saturday_rate_cents >= 0)`,
      `ALTER TABLE workplaces ADD COLUMN sunday_rate_cents INTEGER CHECK (sunday_rate_cents IS NULL OR sunday_rate_cents >= 0)`,
      `ALTER TABLE workplaces ADD COLUMN night_rate_cents INTEGER CHECK (night_rate_cents IS NULL OR night_rate_cents >= 0)`,
      `ALTER TABLE workplaces ADD COLUMN night_start_min INTEGER CHECK (night_start_min IS NULL OR night_start_min BETWEEN 0 AND 1439)`,
      `ALTER TABLE workplaces ADD COLUMN night_end_min INTEGER CHECK (night_end_min IS NULL OR night_end_min BETWEEN 0 AND 1439)`,

      // An .ics link (e.g. a uni timetable). Events are re-imported on each sync.
      `CREATE TABLE calendar_feeds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        url TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#60A5FA',
        last_synced_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL
      )`,
      `ALTER TABLE events ADD COLUMN feed_id INTEGER REFERENCES calendar_feeds(id) ON DELETE CASCADE`,
      `ALTER TABLE events ADD COLUMN uid TEXT`,
      `ALTER TABLE events ADD COLUMN location TEXT`,
      `ALTER TABLE events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1))`,
      `CREATE UNIQUE INDEX idx_events_feed_uid ON events(feed_id, uid, start_at) WHERE feed_id IS NOT NULL`,
      `CREATE INDEX idx_events_feed ON events(feed_id)`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/**
 * Applies pending migrations inside a transaction each, tracking progress in
 * PRAGMA user_version. A failure rolls back that migration and rethrows, so the
 * database is never left half-migrated.
 */
export async function migrate(db: SqlDb): Promise<number> {
  await db.execAsync('PRAGMA foreign_keys = ON');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;
  if (current > LATEST_VERSION) {
    throw new Error(`Database version ${current} is newer than this app supports (${LATEST_VERSION}). Update MyOrbit.`);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.withTransactionAsync(async () => {
      for (const sql of m.statements) await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${m.version}`);
    });
    current = m.version;
  }
  return current;
}
