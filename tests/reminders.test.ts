/**
 * @jest-environment node
 */
import { DEFAULT_SETTINGS, loadSettings, saveSetting } from '@/database/repositories/settings';
import { createAssessment, createSubject } from '@/database/repositories/study';
import { completeTask, createHabit, createTask } from '@/database/repositories/tasks';
import { createShift, createWorkplace, setShiftStatus } from '@/database/repositories/work';
import { leadLabel, MAX_REMINDERS, planReminders } from '@/features/reminders/planReminders';
import { createTestDb } from './helpers/testDb';

// Sat 7 Nov 2026, 10:00 AM (tests run with TZ=Australia/Melbourne).
const NOW = new Date(2026, 10, 7, 10, 0).getTime();
const prefs = { ...DEFAULT_SETTINGS, notificationsEnabled: true };

async function withShift(start = '09:00', end = '17:00', date = '2026-11-10', reminderMinutes?: number | null) {
  const db = await createTestDb();
  const wp = await createWorkplace(db, { name: 'Cafe Nero', defaultRateCents: 3050 });
  const id = await createShift(db, { workplaceId: wp, date, startTime: start, endTime: end, unpaidBreakMinutes: 0, hourlyRateCents: 3050, reminderMinutes });
  return { db, id };
}

describe('planReminders', () => {
  it('plans nothing while reminders are off', async () => {
    const { db } = await withShift();
    expect(await planReminders(db, { ...prefs, notificationsEnabled: false }, NOW)).toEqual([]);
  });

  it('reminds before a shift using the default lead time', async () => {
    const { db, id } = await withShift();
    const [r] = await planReminders(db, prefs, NOW);
    expect(r).toMatchObject({ entityType: 'shift', entityId: id, title: 'Shift in 1 hour', body: 'Cafe Nero · 9:00 AM – 5:00 PM' });
    expect(r!.fireAt).toBe(new Date(2026, 10, 10, 8, 0).getTime());
  });

  it('lets a shift override the default, and 0 turns it off', async () => {
    const custom = await withShift('09:00', '17:00', '2026-11-10', 15);
    expect((await planReminders(custom.db, prefs, NOW))[0]!.title).toBe('Shift in 15 minutes');
    const off = await withShift('09:00', '17:00', '2026-11-10', 0);
    expect(await planReminders(off.db, prefs, NOW)).toEqual([]);
  });

  it('skips cancelled shifts, ones whose reminder time has passed, and ones past the 2-week horizon', async () => {
    const cancelled = await withShift();
    await setShiftStatus(cancelled.db, cancelled.id, 'cancelled');
    expect(await planReminders(cancelled.db, prefs, NOW)).toEqual([]);
    const soon = await withShift('10:30', '18:00', '2026-11-07'); // starts in 30 min, lead is 60
    expect(await planReminders(soon.db, prefs, NOW)).toEqual([]);
    const far = await withShift('09:00', '17:00', '2026-11-30');
    expect(await planReminders(far.db, prefs, NOW)).toEqual([]);
  });

  it('reminds the day before and 2 hours before an assessment', async () => {
    const db = await createTestDb();
    const s = await createSubject(db, { code: 'INTE2667', name: 'Mobile Dev' });
    await createAssessment(db, { subjectId: s, title: 'A3', dueAt: new Date(2026, 10, 12, 23, 59).getTime(), weightBp: 4000 });
    const plan = await planReminders(db, prefs, NOW);
    expect(plan.map((r) => [r.kind, r.title, new Date(r.fireAt).getHours()])).toEqual([
      ['day_before', 'Due tomorrow: A3', 9],
      ['two_hours', 'Due in 2 hours: A3', 21],
    ]);
    expect(plan[0]!.body).toBe('INTE2667 · 11:59 PM');
  });

  it('reminds at 9 AM on a task’s due date, and not once it’s done', async () => {
    const db = await createTestDb();
    const id = await createTask(db, { title: 'Pay rent', priority: 1, category: 'home', dueDate: '2026-11-09', recurrence: 'none' });
    const [r] = await planReminders(db, prefs, NOW);
    expect(r).toMatchObject({ entityType: 'task', title: 'Task due today', body: 'Pay rent', fireAt: new Date(2026, 10, 9, 9, 0).getTime() });
    await completeTask(db, id, '2026-11-07', NOW);
    expect(await planReminders(db, prefs, NOW)).toEqual([]);
  });

  it('adds one daily habit check-in only when habits exist', async () => {
    const db = await createTestDb();
    const on = { ...prefs, remindHabits: true, habitReminderTime: '20:30' };
    expect(await planReminders(db, on, NOW)).toEqual([]);
    await createHabit(db, { name: 'Read', frequency: 'daily', targetPerPeriod: 1 });
    const [r] = await planReminders(db, on, NOW);
    expect(r).toMatchObject({ entityType: 'habit', kind: 'daily', daily: { hour: 20, minute: 30 }, fireAt: new Date(2026, 10, 7, 20, 30).getTime() });
  });

  it('stays under the iOS limit of 64 pending notifications, keeping the soonest', async () => {
    const db = await createTestDb();
    for (let d = 0; d < 13; d++) {
      for (let i = 0; i < 6; i++) await createTask(db, { title: `T${d}-${i}`, priority: 2, category: 'personal', dueDate: `2026-11-${String(8 + d).padStart(2, '0')}`, recurrence: 'none' });
    }
    const plan = await planReminders(db, prefs, NOW);
    expect(plan).toHaveLength(MAX_REMINDERS);
    expect(plan.every((r, i) => i === 0 || r.fireAt >= plan[i - 1]!.fireAt)).toBe(true);
  });

  it('labels lead times in words', () => {
    expect([15, 30, 60, 120].map(leadLabel)).toEqual(['15 minutes', '30 minutes', '1 hour', '2 hours']);
  });
});

describe('reminder settings', () => {
  it('rejects lead times and clock times it doesn’t offer', async () => {
    const db = await createTestDb();
    await expect(saveSetting(db, 'shiftReminderMinutes', 45)).rejects.toThrow();
    await expect(saveSetting(db, 'habitReminderTime', '25:00')).rejects.toThrow();
    await saveSetting(db, 'shiftReminderMinutes', 30);
    await saveSetting(db, 'habitReminderTime', '07:15');
    expect(await loadSettings(db)).toMatchObject({ shiftReminderMinutes: 30, habitReminderTime: '07:15' });
  });
});
