/**
 * @jest-environment node
 */
import { LATEST_VERSION, migrate, MIGRATIONS } from '@/database/migrations';
import { addFeed, listFeeds, removeFeed, syncFeed } from '@/database/repositories/calendarFeeds';
import { shiftPay } from '@/features/work/payRates';
import { buildTodayWidgetProps } from '@/services/widgetSync';
import {
  endActivitySession,
  getActiveActivitySession,
  startActivitySession,
} from '@/database/repositories/activities';
import {
  createExpense,
  createIncome,
  deleteExpense,
  expenseTotalsByCategory,
  listBudgets,
  listCategories,
  listExpenses,
  setBudget,
  totalExpenses,
  totalIncome,
  updateExpense,
} from '@/database/repositories/finance';
import { loadSettings, saveSetting } from '@/database/repositories/settings';
import {
  createAssessment,
  createSubject,
  deleteSubject,
  listAssessments,
  listUpcomingAssessments,
  logStudySession,
  startStudySession,
  studyMinutesBySubject,
} from '@/database/repositories/study';
import {
  completeTask,
  createHabit,
  createTask,
  listHabitsWithStats,
  listTasks,
  toggleHabit,
} from '@/database/repositories/tasks';
import {
  createShift,
  createWorkplace,
  deleteShift,
  listShiftsInRange,
  listUpcomingShifts,
  removeWorkplace,
  setShiftStatus,
  updateShift,
} from '@/database/repositories/work';
import { monthRange } from '@/utils/time';
import { createRawTestDb, createTestDb } from './helpers/testDb';

describe('migrations', () => {
  it('migrates a fresh database to the latest version', async () => {
    const db = createRawTestDb();
    expect(await migrate(db)).toBe(LATEST_VERSION);
    const tables = db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const t of [
      'settings', 'workplaces', 'work_shifts', 'income', 'expenses', 'expense_categories', 'budgets', 'subjects',
      'assessments', 'study_sessions', 'tasks', 'habits', 'habit_logs', 'reminders', 'activity_sessions', 'events',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('is idempotent and keeps data on re-run', async () => {
    const db = await createTestDb();
    await createTask(db, { title: 'Keep me', priority: 2, category: 'personal', dueDate: null, recurrence: 'none' });
    await migrate(db);
    expect(await listTasks(db)).toHaveLength(1);
  });

  it('rolls back a failing migration without partial changes', async () => {
    const db = await createTestDb();
    MIGRATIONS.push({ version: LATEST_VERSION + 1, description: 'broken', statements: ['CREATE TABLE x (id INTEGER)', 'NOT SQL'] });
    try {
      await expect(migrate(db)).rejects.toThrow();
      const v = db.raw.pragma('user_version', { simple: true });
      expect(v).toBe(LATEST_VERSION);
      expect(db.raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'x'`).get()).toBeUndefined();
    } finally {
      MIGRATIONS.pop();
    }
  });

  it('refuses to open a database from a newer app version', async () => {
    const db = await createTestDb();
    db.raw.pragma(`user_version = ${LATEST_VERSION + 5}`);
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });

  it('enforces foreign keys', async () => {
    const db = await createTestDb();
    await expect(
      db.runAsync('INSERT INTO expenses (category_id, amount_cents, spent_date, description, created_at, updated_at) VALUES (999, 1, ?, ?, 0, 0)', [
        '2026-11-07',
        'x',
      ]),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('seeds the default expense categories', async () => {
    const db = await createTestDb();
    expect((await listCategories(db)).map((c) => c.name)).toEqual([
      'Rent', 'Groceries', 'Transport', 'Electricity', 'Internet', 'Shopping', 'Entertainment', 'Education', 'Other',
    ]);
  });
});

describe('work repository', () => {
  async function setup() {
    const db = await createTestDb();
    const wp = await createWorkplace(db, { name: 'Cafe Nero', defaultRateCents: 3050 });
    return { db, wp };
  }
  const shift = (wp: number, date: string, startTime: string, endTime: string) => ({
    workplaceId: wp,
    date,
    startTime,
    endTime,
    unpaidBreakMinutes: 30,
    hourlyRateCents: 3050,
  });

  it('creates, reads, updates and deletes shifts', async () => {
    const { db, wp } = await setup();
    const id = await createShift(db, shift(wp, '2026-11-10', '09:00', '17:00'));
    let list = await listShiftsInRange(db, monthRange('2026-11-01'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ workplaceName: 'Cafe Nero', status: 'scheduled' });

    await updateShift(db, id, shift(wp, '2026-11-10', '10:00', '18:00'));
    list = await listShiftsInRange(db, monthRange('2026-11-01'));
    expect(new Date(list[0]!.startAt).getHours()).toBe(10);

    await deleteShift(db, id);
    expect(await listShiftsInRange(db, monthRange('2026-11-01'))).toHaveLength(0);
  });

  it('rejects duplicate and overlapping shifts, but allows them once cancelled', async () => {
    const { db, wp } = await setup();
    const id = await createShift(db, shift(wp, '2026-11-10', '09:00', '17:00'));
    await expect(createShift(db, shift(wp, '2026-11-10', '09:00', '17:00'))).rejects.toThrow(/overlaps/);
    await expect(createShift(db, shift(wp, '2026-11-10', '16:00', '20:00'))).rejects.toThrow(/overlaps/);
    await createShift(db, shift(wp, '2026-11-10', '17:00', '21:00')); // touching is fine
    await setShiftStatus(db, id, 'cancelled');
    await expect(createShift(db, shift(wp, '2026-11-10', '08:00', '12:00'))).resolves.toBeGreaterThan(0);
  });

  it('stores overnight shifts on their start date', async () => {
    const { db, wp } = await setup();
    await createShift(db, shift(wp, '2026-11-30', '22:00', '06:00'));
    const nov = await listShiftsInRange(db, monthRange('2026-11-01'));
    expect(nov).toHaveLength(1);
    expect(new Date(nov[0]!.endAt).getDate()).toBe(1);
  });

  it('lists upcoming scheduled shifts only', async () => {
    const { db, wp } = await setup();
    const past = await createShift(db, shift(wp, '2026-11-01', '09:00', '17:00'));
    await createShift(db, shift(wp, '2026-11-20', '09:00', '17:00'));
    await setShiftStatus(db, past, 'completed');
    const upcoming = await listUpcomingShifts(db, new Date(2026, 10, 7).getTime());
    expect(upcoming).toHaveLength(1);
  });

  it('archives workplaces that have shifts instead of deleting history', async () => {
    const { db, wp } = await setup();
    await createShift(db, shift(wp, '2026-11-10', '09:00', '17:00'));
    expect(await removeWorkplace(db, wp)).toBe('archived');
    const other = await createWorkplace(db, { name: 'Library', defaultRateCents: 2800 });
    expect(await removeWorkplace(db, other)).toBe('deleted');
    await expect(createWorkplace(db, { name: 'cafe nero', defaultRateCents: 1 })).rejects.toThrow(/already exists/);
  });
});

describe('finance repository', () => {
  it('handles expenses end to end with integer cents', async () => {
    const db = await createTestDb();
    const [rent, groceries] = await listCategories(db);
    const id = await createExpense(db, { categoryId: groceries!.id, amountCents: 1999, spentDate: '2026-11-05', description: 'Coles' });
    await createExpense(db, { categoryId: groceries!.id, amountCents: 1, spentDate: '2026-11-06', description: '10% off_test' });
    await createExpense(db, { categoryId: rent!.id, amountCents: 45000, spentDate: '2026-11-01', description: 'Rent' });
    await createExpense(db, { categoryId: rent!.id, amountCents: 45000, spentDate: '2026-10-01', description: 'Rent' });

    const nov = monthRange('2026-11-01');
    expect(await totalExpenses(db, nov)).toBe(47000);
    expect((await listExpenses(db, { range: nov, search: 'coles' })).map((e) => e.id)).toEqual([id]);
    // LIKE wildcards in the search are treated literally.
    expect(await listExpenses(db, { search: '%' })).toHaveLength(1);
    expect(await listExpenses(db, { search: '_' })).toHaveLength(1);
    expect(await listExpenses(db, { categoryId: rent!.id })).toHaveLength(2);

    const totals = await expenseTotalsByCategory(db, nov);
    expect(totals[0]).toMatchObject({ name: 'Rent', totalCents: 45000 });
    expect(totals).toHaveLength(9);

    await updateExpense(db, id, { categoryId: groceries!.id, amountCents: 2500, spentDate: '2026-11-05', description: 'Coles' });
    expect(await totalExpenses(db, nov)).toBe(47501);
    await deleteExpense(db, id);
    expect(await totalExpenses(db, nov)).toBe(45001);
  });

  it('blocks accidental duplicate expenses', async () => {
    const db = await createTestDb();
    const [cat] = await listCategories(db);
    const e = { categoryId: cat!.id, amountCents: 500, spentDate: '2026-11-07', description: 'Coffee' };
    await createExpense(db, e);
    await expect(createExpense(db, e)).rejects.toThrow(/duplicate/);
  });

  it('validates inputs', async () => {
    const db = await createTestDb();
    const [cat] = await listCategories(db);
    await expect(createExpense(db, { categoryId: cat!.id, amountCents: 0, spentDate: '2026-11-07', description: 'x' })).rejects.toThrow();
    await expect(createExpense(db, { categoryId: cat!.id, amountCents: 1.5, spentDate: '2026-11-07', description: 'x' })).rejects.toThrow();
    await expect(createExpense(db, { categoryId: cat!.id, amountCents: 100, spentDate: '2026-02-30', description: 'x' })).rejects.toThrow();
    await expect(createExpense(db, { categoryId: cat!.id, amountCents: 100, spentDate: '2026-11-07', description: ' ' })).rejects.toThrow();
  });

  it('tracks income separately from estimated shift earnings', async () => {
    const db = await createTestDb();
    await createIncome(db, { amountCents: 123456, payDate: '2026-11-14', category: 'wages', source: 'Cafe Nero' });
    expect(await totalIncome(db, monthRange('2026-11-01'))).toBe(123456);
  });

  it('upserts one budget per category and one overall budget', async () => {
    const db = await createTestDb();
    const [cat] = await listCategories(db);
    await setBudget(db, null, 200000);
    await setBudget(db, null, 250000, 15);
    await setBudget(db, cat!.id, 90000);
    await setBudget(db, cat!.id, 95000);
    const budgets = await listBudgets(db);
    expect(budgets).toHaveLength(2);
    expect(budgets[0]).toMatchObject({ categoryId: null, limitCents: 250000, periodStartDay: 15 });
    await expect(db.runAsync('INSERT INTO budgets (category_id, limit_cents, created_at, updated_at) VALUES (NULL, 1, 0, 0)')).rejects.toThrow(
      /UNIQUE/,
    );
  });
});

describe('study repository', () => {
  it('validates weightings and cascades subject deletion', async () => {
    const db = await createTestDb();
    const s = await createSubject(db, { code: 'inte2667', name: 'Mobile Dev' });
    await createAssessment(db, { subjectId: s, title: 'A1', dueAt: new Date(2026, 10, 20).getTime(), weightBp: 6000 });
    await expect(createAssessment(db, { subjectId: s, title: 'A2', dueAt: null, weightBp: 5000 })).rejects.toThrow(/over 100%/);
    await expect(
      createAssessment(db, { subjectId: s, title: 'A2', dueAt: null, weightBp: 4000, markObtained: 41, markTotal: 40 }),
    ).rejects.toThrow(/between 0 and the total/);
    await createAssessment(db, { subjectId: s, title: 'A2', dueAt: null, weightBp: 4000, markObtained: 30, markTotal: 40 });

    const all = await listAssessments(db, s);
    expect(all.map((a) => a.status)).toEqual(['pending', 'marked']);
    expect(await listUpcomingAssessments(db, new Date(2026, 10, 7).getTime())).toHaveLength(1);

    await logStudySession(db, s, '2026-11-07', new Date(2026, 10, 7, 9).getTime(), 90);
    expect((await studyMinutesBySubject(db, monthRange('2026-11-01'))).get(s)).toBe(90);

    await deleteSubject(db, s);
    expect(await listAssessments(db)).toHaveLength(0);
    expect(await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM study_sessions')).toEqual({ n: 0 });
  });
});

describe('tasks and habits', () => {
  it('completes one-off tasks and rolls recurring tasks forward once', async () => {
    const db = await createTestDb();
    const once = await createTask(db, { title: 'Buy milk', priority: 1, category: 'home', dueDate: '2026-11-07', recurrence: 'none' });
    const weekly = await createTask(db, { title: 'Bins', priority: 2, category: 'home', dueDate: '2026-11-07', recurrence: 'weekly' });
    await completeTask(db, once, '2026-11-07');
    await completeTask(db, once, '2026-11-07'); // idempotent
    await completeTask(db, weekly, '2026-11-07');
    const open = await listTasks(db);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: weekly, dueDate: '2026-11-14' });
    expect(await listTasks(db, { status: 'done' })).toHaveLength(1);
    await expect(createTask(db, { title: 'x', priority: 2, category: 'home', dueDate: null, recurrence: 'daily' })).rejects.toThrow();
  });

  it('toggles habits once per day and reports streaks', async () => {
    const db = await createTestDb();
    const h = await createHabit(db, { name: 'Read', frequency: 'daily', targetPerPeriod: 1 });
    await toggleHabit(db, h, '2026-11-05');
    await toggleHabit(db, h, '2026-11-06');
    expect(await toggleHabit(db, h, '2026-11-07')).toBe(true);
    expect(await toggleHabit(db, h, '2026-11-07')).toBe(false);
    await toggleHabit(db, h, '2026-11-07');
    const [habit] = await listHabitsWithStats(db, '2026-11-07');
    expect(habit).toMatchObject({ doneToday: true, stats: { currentStreak: 3 } });
  });
});

describe('settings', () => {
  it('persists typed settings and ignores corrupt values', async () => {
    const db = await createTestDb();
    expect((await loadSettings(db)).theme).toBe('system');
    await saveSetting(db, 'theme', 'dark');
    await db.runAsync(`INSERT INTO settings (key, value, updated_at) VALUES ('hapticsEnabled', '{bad json', 0)`);
    await db.runAsync(`INSERT INTO settings (key, value, updated_at) VALUES ('autoLockSeconds', '"sixty"', 0)`);
    const s = await loadSettings(db);
    expect(s).toMatchObject({ theme: 'dark', hapticsEnabled: true, autoLockSeconds: 60 });
    await expect(saveSetting(db, 'theme', 'neon' as never)).rejects.toThrow();
  });
});

describe('activity sessions', () => {
  it('keeps a single active session and recovers or expires it after restart', async () => {
    const db = await createTestDb();
    const now = new Date(2026, 10, 7, 9).getTime();
    const a = await startActivitySession(db, { kind: 'focus', title: 'Focus', startsAt: now, endsAt: now + 25 * 60_000 }, now);
    const b = await startActivitySession(db, { kind: 'study', title: 'Study', startsAt: now, endsAt: now + 50 * 60_000 }, now);
    expect(a.id).not.toBe(b.id);
    expect((await getActiveActivitySession(db, now + 60_000))?.id).toBe(b.id);
    // Simulate relaunch after the session should have ended.
    expect(await getActiveActivitySession(db, now + 51 * 60_000)).toBeNull();
    const rows = await db.getAllAsync<{ status: string }>('SELECT status FROM activity_sessions ORDER BY id');
    expect(rows.map((r) => r.status)).toEqual(['cancelled', 'completed']);
    await endActivitySession(db, b.id, 'cancelled');
    await expect(db.runAsync(`UPDATE activity_sessions SET status = 'active'`)).rejects.toThrow(/UNIQUE/);
    await expect(
      startActivitySession(db, { kind: 'focus', title: 'x', startsAt: now, endsAt: now - 1 }, now),
    ).rejects.toThrow();
  });

  it('closes the linked study session when a timed study activity ends or expires', async () => {
    const db = await createTestDb();
    const s = await createSubject(db, { name: 'Maths' });
    const now = new Date(2026, 10, 7, 9).getTime();
    const studyId = await startStudySession(db, s, 30, now);
    await startActivitySession(db, { kind: 'study', title: 'Maths', entityType: 'study', entityId: studyId, startsAt: now, endsAt: now + 30 * 60_000 }, now);
    // App relaunched an hour later: activity auto-completes at its end time, not at relaunch time.
    expect(await getActiveActivitySession(db, now + 60 * 60_000)).toBeNull();
    expect((await studyMinutesBySubject(db, monthRange('2026-11-01'))).get(s)).toBe(30);

    const second = await startStudySession(db, s, 50, now + 2 * 3_600_000);
    const act = await startActivitySession(
      db,
      { kind: 'study', title: 'Maths', entityType: 'study', entityId: second, startsAt: now + 2 * 3_600_000, endsAt: now + 3 * 3_600_000 },
      now + 2 * 3_600_000,
    );
    await endActivitySession(db, act.id, 'cancelled', now + 2 * 3_600_000 + 10 * 60_000);
    expect((await studyMinutesBySubject(db, monthRange('2026-11-01'))).get(s)).toBe(40);
  });
});

describe('migration 2: assessment kind', () => {
  it('upgrades a version-1 database without losing assessments, defaulting kind to assignment', async () => {
    const db = createRawTestDb();
    const v1 = MIGRATIONS.filter((m) => m.version === 1);
    await db.execAsync('PRAGMA foreign_keys = ON');
    for (const sql of v1[0]!.statements) await db.execAsync(sql);
    await db.execAsync('PRAGMA user_version = 1');
    await db.runAsync(`INSERT INTO subjects (name, created_at, updated_at) VALUES ('Maths', 0, 0)`);
    await db.runAsync(
      `INSERT INTO assessments (subject_id, title, weight_bp, created_at, updated_at) VALUES (1, 'Old A1', 3000, 0, 0)`,
    );
    expect(await migrate(db)).toBe(LATEST_VERSION);
    const [a] = await listAssessments(db);
    expect(a).toMatchObject({ title: 'Old A1', kind: 'assignment' });
  });

  it('stores exams and rejects unknown kinds', async () => {
    const db = await createTestDb();
    const s = await createSubject(db, { name: 'Physics' });
    await createAssessment(db, { subjectId: s, kind: 'exam', title: 'Final', dueAt: null, weightBp: 5000 });
    expect((await listAssessments(db, s))[0]?.kind).toBe('exam');
    await expect(createAssessment(db, { subjectId: s, kind: 'essay' as never, title: 'X', dueAt: null, weightBp: 100 })).rejects.toThrow(/type/);
    await expect(db.runAsync(`UPDATE assessments SET kind = 'essay'`)).rejects.toThrow(/CHECK/);
  });
});

describe('migration 3: penalty rates and calendar feeds', () => {
  it('stores penalty rates and applies them to shift pay', async () => {
    const db = await createTestDb();
    const wp = await createWorkplace(db, {
      name: 'Bar',
      defaultRateCents: 3000,
      saturdayRateCents: 3750,
      sundayRateCents: 4500,
      nightRateCents: 3600,
      nightStartMin: 19 * 60,
      nightEndMin: 7 * 60,
    });
    await expect(createWorkplace(db, { name: 'Bad', defaultRateCents: 3000, nightRateCents: 3600, nightStartMin: 600, nightEndMin: 600 })).rejects.toThrow(/Night/);
    // Sat 14 Nov 2026 10 PM – Sun 2 AM
    await createShift(db, { workplaceId: wp, date: '2026-11-14', startTime: '22:00', endTime: '02:00', unpaidBreakMinutes: 0, hourlyRateCents: 3000 });
    const [s] = await listShiftsInRange(db, monthRange('2026-11-01'));
    expect(s!.rates).toMatchObject({ baseCents: 3000, saturdayCents: 3750, sundayCents: 4500 });
    expect(shiftPay(s!, s!.rates).grossCents).toBe(7500 + 9000);
  });

  it('syncs a feed, replaces events on re-sync, and keeps old events when a sync fails', async () => {
    const db = await createTestDb();
    const id = await addFeed(db, { name: 'Uni', url: 'webcal://uni.example.edu/me.ics' });
    await expect(addFeed(db, { name: 'Dup', url: 'https://uni.example.edu/me.ics' })).rejects.toThrow(/already/);
    const feed = (await listFeeds(db))[0]!;
    expect(feed.url).toBe('https://uni.example.edu/me.ics');

    const ics = (title: string) =>
      `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nSUMMARY:${title}\nDTSTART:20261110T230000Z\nDTEND:20261111T000000Z\nRRULE:FREQ=WEEKLY;COUNT=3\nEND:VEVENT\nEND:VCALENDAR`;
    const ok = (body: string) => async () => ({ ok: true, status: 200, text: async () => body, headers: { get: () => null } });
    const now = new Date(2026, 10, 7).getTime();

    expect(await syncFeed(db, feed, ok(ics('Lecture')), now)).toBe(3);
    expect(await syncFeed(db, feed, ok(ics('Lecture v2')), now)).toBe(3);
    const rows = await db.getAllAsync<{ title: string }>('SELECT title FROM events WHERE feed_id = ?', [id]);
    expect(rows).toEqual([{ title: 'Lecture v2' }, { title: 'Lecture v2' }, { title: 'Lecture v2' }]);

    const fail = async () => ({ ok: false, status: 404, text: async () => '', headers: { get: () => null } });
    await expect(syncFeed(db, feed, fail, now)).rejects.toThrow(/404/);
    expect((await listFeeds(db))[0]!.lastError).toMatch(/404/);
    expect(await db.getAllAsync('SELECT id FROM events WHERE feed_id = ?', [id])).toHaveLength(3);

    await removeFeed(db, id);
    expect(await db.getAllAsync('SELECT id FROM events')).toHaveLength(0);
  });
});

describe('widget snapshot', () => {
  it('shows the next item and agenda, and hides money unless allowed', async () => {
    const db = await createTestDb();
    const wp = await createWorkplace(db, { name: 'Cafe', defaultRateCents: 3000 });
    const now = new Date(2026, 10, 10, 8, 0).getTime();
    await createShift(db, { workplaceId: wp, date: '2026-11-10', startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 0, hourlyRateCents: 3000 });
    await createShift(db, { workplaceId: wp, date: '2026-11-10', startTime: '18:00', endTime: '20:00', unpaidBreakMinutes: 0, hourlyRateCents: 3000 });
    await createTask(db, { title: 'Submit', priority: 1, category: 'study', dueDate: '2026-11-10', recurrence: 'none' });

    const hidden = await buildTodayWidgetProps(db, { hideAmountsInWidgets: true }, now);
    expect(hidden).toMatchObject({ dateLabel: 'Tue 10 Nov', nextTitle: 'Cafe', nextTime: '9:00 AM – 5:00 PM', tasksLeft: 1, moneyLine: '' });
    expect(JSON.stringify(hidden)).not.toContain('null'); // UserDefaults can't store null
    expect(hidden.agenda.map((a) => a.time)).toEqual(['6:00 PM – 8:00 PM']);

    const shown = await buildTodayWidgetProps(db, { hideAmountsInWidgets: false }, now);
    expect(shown.moneyLine).toMatch(/^Spent \$0 this month/);
  });
});
