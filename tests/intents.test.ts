/**
 * @jest-environment node
 */
import { getActiveActivitySession, startActivitySession } from '@/database/repositories/activities';
import { listExpenses } from '@/database/repositories/finance';
import { DEFAULT_SETTINGS } from '@/database/repositories/settings';
import { createTask, listTasks } from '@/database/repositories/tasks';
import { applyIntentActions, parseIntentAction } from '@/features/intents/intentActions';
import { buildTodayWidgetProps, tickedTaskIds } from '@/services/widgetSync';
import { monthRange } from '@/utils/time';
import { createTestDb } from './helpers/testDb';

const TODAY = '2026-11-07';
const NOW = new Date(2026, 10, 7, 10, 0).getTime();

describe('parseIntentAction', () => {
  it('accepts the actions the Siri intents queue', () => {
    expect(parseIntentAction('{"type":"startTimer","kind":"focus","minutes":25,"queuedAt":1}')).toEqual({ type: 'startTimer', kind: 'focus', minutes: 25 });
    expect(parseIntentAction('{"type":"addExpense","amountCents":1250,"description":" lunch ","date":"2026-11-07"}')).toEqual({ type: 'addExpense', amountCents: 1250, description: 'lunch', date: TODAY });
    expect(parseIntentAction('{"type":"addTask","title":"Email tutor","date":"2026-11-07"}')).toEqual({ type: 'addTask', title: 'Email tutor', date: TODAY });
  });

  it('drops anything malformed or out of range', () => {
    for (const bad of [
      'not json',
      'null',
      '{"type":"deleteEverything"}',
      '{"type":"startTimer","kind":"focus","minutes":1}',
      '{"type":"startTimer","kind":"nap","minutes":25}',
      '{"type":"addExpense","amountCents":-5,"date":"2026-11-07"}',
      '{"type":"addExpense","amountCents":12.5,"date":"2026-11-07"}',
      '{"type":"addExpense","amountCents":100,"date":"7/11/2026"}',
      '{"type":"addTask","title":"   ","date":"2026-11-07"}',
      '{"type":"completeTask","taskId":"1"}',
    ]) {
      expect(parseIntentAction(bad)).toBeNull();
    }
  });
});

describe('applyIntentActions', () => {
  it('starts a focus timer and asks to show it', async () => {
    const db = await createTestDb();
    const r = await applyIntentActions(db, [{ type: 'startTimer', kind: 'focus', minutes: 30 }], TODAY, NOW);
    expect(r).toMatchObject({ openTimer: true, timerBusy: false });
    expect(await getActiveActivitySession(db, NOW)).toMatchObject({ kind: 'focus', title: 'Focus session', startsAt: NOW, endsAt: NOW + 30 * 60_000 });
  });

  it('never replaces a timer that is already running', async () => {
    const db = await createTestDb();
    await startActivitySession(db, { kind: 'study', title: 'Mobile Dev', startsAt: NOW, endsAt: NOW + 3_600_000 }, NOW);
    const r = await applyIntentActions(db, [{ type: 'startTimer', kind: 'break', minutes: 10 }], TODAY, NOW);
    expect(r).toMatchObject({ openTimer: true, timerBusy: true });
    expect((await getActiveActivitySession(db, NOW))?.title).toBe('Mobile Dev');
  });

  it('adds expenses and tasks through the normal repositories, and reports them', async () => {
    const db = await createTestDb();
    const r = await applyIntentActions(
      db,
      [
        { type: 'addExpense', amountCents: 1250, description: 'lunch', date: TODAY },
        { type: 'addTask', title: 'Email tutor', date: TODAY },
      ],
      TODAY,
      NOW,
    );
    expect(r.added).toEqual(['$12.50 · lunch', 'Task · Email tutor']);
    expect((await listExpenses(db, { range: monthRange(TODAY) })).map((e) => [e.description, e.amountCents, e.categoryName])).toEqual([['lunch', 1250, 'Other']]);
    expect((await listTasks(db)).map((t) => [t.title, t.dueDate])).toEqual([['Email tutor', TODAY]]);
  });

  it('completes ticked tasks once, ignoring ones already done or deleted', async () => {
    const db = await createTestDb();
    const id = await createTask(db, { title: 'Pay rent', priority: 1, category: 'home', dueDate: TODAY, recurrence: 'none' });
    const actions = [{ type: 'completeTask' as const, taskId: id }, { type: 'completeTask' as const, taskId: id }, { type: 'completeTask' as const, taskId: 999 }];
    await applyIntentActions(db, actions, TODAY, NOW);
    expect((await listTasks(db, { status: 'done' })).map((t) => t.title)).toEqual(['Pay rent']);
  });
});

describe('widget tick-off', () => {
  it('lists today’s open tasks in the widget, with no ticks pending', async () => {
    const db = await createTestDb();
    const id = await createTask(db, { title: 'Pay rent', priority: 1, category: 'home', dueDate: TODAY, recurrence: 'none' });
    const props = await buildTodayWidgetProps(db, DEFAULT_SETTINGS, NOW);
    expect(props.tasks).toEqual([{ id, title: 'Pay rent' }]);
    expect(props.doneTaskIds).toEqual([]);
    expect(JSON.stringify(props)).not.toContain('null');
  });

  it('collects ticked ids across timeline entries, ignoring junk', () => {
    expect(tickedTaskIds([{ props: { doneTaskIds: [3, 5] } }, { props: { doneTaskIds: [5, 'x', -1, 7.5] } }, { props: {} }])).toEqual([3, 5]);
  });
});
