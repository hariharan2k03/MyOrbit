/**
 * @jest-environment node
 */
import { createExpense, listCategories, listExpenses, setBudget } from '@/database/repositories/finance';
import { createAssessment, createSubject } from '@/database/repositories/study';
import { createTask, listTasks } from '@/database/repositories/tasks';
import { createShift, createWorkplace, listShiftsInRange, listWorkplaces } from '@/database/repositories/work';
import { buildFacts, freeBlocks } from '@/features/ai/aiFacts';
import { describeDraft, resolveDate, resolveDraft, resolveTime, saveDraft, type RawDraft } from '@/features/ai/quickAdd';
import { aiAvailability } from '@/services/ai';
import { monthRange } from '@/utils/time';
import { createTestDb } from './helpers/testDb';

// Sat 7 Nov 2026 (tests run with TZ=Australia/Melbourne).
const TODAY = '2026-11-07';
const at = (h: number, m = 0, d = 7) => new Date(2026, 10, d, h, m).getTime();
const raw = (r: Partial<RawDraft>): RawDraft => ({ kind: '', title: '', dateText: '', startTime: '', endTime: '', amount: 0, category: '', ...r });

describe('resolveDate', () => {
  it.each([
    ['today', '2026-11-07'],
    ['tomorrow', '2026-11-08'],
    ['Sat', '2026-11-07'],
    ['next sat', '2026-11-14'],
    ['Monday', '2026-11-09'],
    ['fri', '2026-11-13'],
    ['12 Nov', '2026-11-12'],
    ['Nov 12', '2026-11-12'],
    ['12/11', '2026-11-12'],
    ['3 Jan', '2027-01-03'],
    ['2026-12-01', '2026-12-01'],
    ['Sat 7 Nov', '2026-11-07'],
    ['Saturday, 7 November 2026', '2026-11-07'],
    ['Thu Nov 12', '2026-11-12'],
  ])('%s → %s', (text, expected) => expect(resolveDate(text, TODAY)).toBe(expected));

  it('returns null for empty or unclear text', () => {
    expect(resolveDate('', TODAY)).toBeNull();
    expect(resolveDate('sometime', TODAY)).toBeNull();
    expect(resolveDate('31/02', TODAY)).toBeNull();
  });
});

describe('resolveTime', () => {
  it('reads 24-hour and am/pm times', () => {
    expect(resolveTime('09:00')).toEqual({ minutes: 540, meridiem: false });
    expect(resolveTime('5pm')).toEqual({ minutes: 1020, meridiem: true });
    expect(resolveTime('12am')).toEqual({ minutes: 0, meridiem: true });
    expect(resolveTime('9:30 pm')).toEqual({ minutes: 1290, meridiem: true });
    expect(resolveTime('25:00')).toBeNull();
    expect(resolveTime('13pm')).toBeNull();
  });
});

async function setup() {
  const db = await createTestDb();
  const wp = await createWorkplace(db, { name: 'Woolworths Metro', defaultRateCents: 3200 });
  const [workplaces, categories] = await Promise.all([listWorkplaces(db), listCategories(db)]);
  return { db, wp, ctx: { today: TODAY, workplaces, categories } };
}

describe('quick add', () => {
  it('turns "shift at Woolworths Sat 9-5" into a 9 AM–5 PM shift at the matching workplace', async () => {
    const { db, ctx } = await setup();
    const r = resolveDraft(raw({ kind: 'shift', title: 'Woolworths', dateText: 'Sat', startTime: '09:00', endTime: '05:00' }), ctx);
    expect(r).toMatchObject({ ok: true, draft: { kind: 'shift', date: '2026-11-07', startTime: '09:00', endTime: '17:00' } });
    if (!r.ok) return;
    expect(describeDraft(r.draft).lines).toEqual(['Woolworths Metro', 'Sat 7 Nov, 9:00 AM – 5:00 PM', 'Base rate $32.00/hr']);
    await saveDraft(db, r.draft);
    const shifts = await listShiftsInRange(db, monthRange(TODAY));
    expect(shifts.map((s) => [s.workplaceName, s.startAt, s.endAt])).toEqual([['Woolworths Metro', at(9), at(17)]]);
  });

  it('keeps an overnight shift overnight when am/pm makes it clear', async () => {
    const { ctx } = await setup();
    const r = resolveDraft(raw({ kind: 'shift', title: 'woolworths metro', dateText: 'fri', startTime: '10pm', endTime: '6am' }), ctx);
    expect(r).toMatchObject({ ok: true, draft: { date: '2026-11-13', startTime: '22:00', endTime: '06:00' } });
  });

  it('asks for a workplace that exists, and for times', async () => {
    const { ctx } = await setup();
    expect(resolveDraft(raw({ kind: 'shift', title: 'Coles', startTime: '9', endTime: '5' }), ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/isn’t one of your workplaces/) });
    expect(resolveDraft(raw({ kind: 'shift', title: 'Woolworths' }), ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/start and finish/) });
  });

  it('adds an expense in the matching category, defaulting to today and to Other', async () => {
    const { db, ctx } = await setup();
    const r = resolveDraft(raw({ kind: 'expense', title: 'lunch', amount: 12.5, category: 'groceries' }), ctx);
    expect(r).toMatchObject({ ok: true, draft: { amountCents: 1250, date: TODAY, category: { name: 'Groceries' } } });
    expect(resolveDraft(raw({ kind: 'expense', title: 'thing', amount: 3, category: 'nonsense' }), ctx)).toMatchObject({ ok: true, draft: { category: { name: 'Other' } } });
    expect(resolveDraft(raw({ kind: 'expense', title: 'free', amount: 0 }), ctx)).toMatchObject({ ok: false });
    if (r.ok) await saveDraft(db, r.draft);
    expect((await listExpenses(db, { range: monthRange(TODAY) })).map((e) => [e.description, e.amountCents])).toEqual([['lunch', 1250]]);
  });

  it('adds a task with its due date, and says when it can’t read a date', async () => {
    const { db, ctx } = await setup();
    const r = resolveDraft(raw({ kind: 'task', title: 'Email tutor', dateText: 'tomorrow' }), ctx);
    expect(r).toMatchObject({ ok: true, draft: { kind: 'task', title: 'Email tutor', dueDate: '2026-11-08' } });
    if (r.ok) await saveDraft(db, r.draft);
    expect((await listTasks(db)).map((t) => [t.title, t.dueDate])).toEqual([['Email tutor', '2026-11-08']]);
    expect(resolveDraft(raw({ kind: 'task', title: 'x', dateText: 'whenever' }), ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/couldn’t work out the date/) });
  });

  it('links pay to the workplace it came from', async () => {
    const { ctx, wp } = await setup();
    expect(resolveDraft(raw({ kind: 'income', title: 'Woolworths', amount: 456.8 }), ctx)).toMatchObject({ ok: true, draft: { category: 'wages', workplaceId: wp, amountCents: 45680 } });
  });
});

describe('AI facts', () => {
  it('finds free blocks around busy times, from now until 10 PM', () => {
    const busy = [{ startAt: at(12), endAt: at(13) }, { startAt: at(18), endAt: at(21, 30) }];
    const blocks = freeBlocks(busy, TODAY, at(10, 10));
    expect(blocks.map((b) => [new Date(b.startAt).getHours(), new Date(b.startAt).getMinutes(), new Date(b.endAt).getHours(), new Date(b.endAt).getMinutes()])).toEqual([
      [10, 30, 12, 0],
      [13, 0, 18, 0],
    ]);
  });

  it('states exact totals the model can quote', async () => {
    const { db, wp } = await setup();
    await createShift(db, { workplaceId: wp, date: '2026-11-05', startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 0, hourlyRateCents: 3200 });
    await createShift(db, { workplaceId: wp, date: '2026-11-10', startTime: '09:00', endTime: '13:00', unpaidBreakMinutes: 0, hourlyRateCents: 3200 });
    const groceries = (await listCategories(db)).find((c) => c.name === 'Groceries')!;
    await createExpense(db, { categoryId: groceries.id, amountCents: 8450, spentDate: '2026-11-03', description: 'Weekly shop' });
    await setBudget(db, null, 50000);
    const s = await createSubject(db, { code: 'INTE2667', name: 'Mobile Dev' });
    await createAssessment(db, { subjectId: s, title: 'A3', dueAt: at(23, 59, 12), weightBp: 4000 });
    await createTask(db, { title: 'Pay rent', priority: 1, category: 'home', dueDate: TODAY, recurrence: 'none' });

    const facts = await buildFacts(db, { taxResidency: 'resident' }, at(10));
    expect(facts).toContain('Today is Sat 7 Nov 2026, 10:00 AM.');
    expect(facts).toContain('This week (Mon 2 Nov – Sun 8 Nov): 1 shift, 8h paid, earned $256.00 before tax');
    expect(facts).toContain('This month (Nov 2026): 2 shifts, 12h paid, earned $384.00 before tax');
    expect(facts).toContain('Upcoming shifts: Tue 10 Nov 9:00 AM – 1:00 PM at Woolworths Metro ($128.00)');
    expect(facts).toContain('Spent: $84.50.');
    expect(facts).toContain('Budget $500.00: $415.50 left.');
    expect(facts).toContain('Groceries $84.50');
    expect(facts).toContain('A3 (Mobile Dev, worth 40%) due Thu 12 Nov 11:59 PM');
    expect(facts).toContain('Due today: Pay rent.');
  });
});

describe('availability', () => {
  it('reports unsupported when the native module isn’t there (tests, older builds)', () => {
    expect(aiAvailability()).toBe('unsupportedOS');
  });
});
