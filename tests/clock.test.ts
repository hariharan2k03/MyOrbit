import {
  clockInShift,
  clockOutShift,
  createShift,
  createWorkplace,
  getClockShift,
  getShift,
  listShiftsInRange,
  setWorkedTimes,
} from '@/database/repositories/work';
import { planReminders } from '@/features/reminders/planReminders';
import { clockedDifference, clockState, worked } from '@/features/work/clock';
import { shiftPay } from '@/features/work/payRates';
import { applyRoster, diffRoster, includedByDefault, type RosterDraft } from '@/features/work/rosterSync';
import { createTestDb } from './helpers/testDb';

// TZ=Australia/Melbourne (see package.json). Tue 10 Nov 2026.
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const rules = { clockInEarlyMinutes: 10, clockOutEarlyMinutes: 30 };

describe('clock rules', () => {
  const shift = { startAt: at(10, 18), endAt: at(10, 22), status: 'scheduled' as const, clockInAt: null, clockOutAt: null };

  it('opens Clock In 10 minutes before the start', () => {
    expect(clockState(shift, at(10, 17, 49), rules)).toEqual({ kind: 'not_yet', opensAt: at(10, 17, 50) });
    expect(clockState(shift, at(10, 17, 50), rules)).toEqual({ kind: 'can_clock_in', late: false });
    expect(clockState(shift, at(10, 18, 5), rules)).toEqual({ kind: 'can_clock_in', late: true });
    expect(clockState(shift, at(10, 22), rules)).toEqual({ kind: 'missed' });
  });

  it('opens Clock Out 30 minutes before the end', () => {
    const working = { ...shift, clockInAt: at(10, 17, 52) };
    expect(clockState(working, at(10, 21, 29), rules)).toMatchObject({ kind: 'working', canClockOut: false, clockOutOpensAt: at(10, 21, 30) });
    expect(clockState(working, at(10, 21, 30), rules)).toMatchObject({ kind: 'working', canClockOut: true, overtime: false });
    expect(clockState(working, at(10, 22, 15), rules)).toMatchObject({ kind: 'working', canClockOut: true, overtime: true });
  });

  it('uses clocked times for hours and pay once clocked out', () => {
    const done = { ...shift, unpaidBreakMinutes: 0, clockInAt: at(10, 17, 52), clockOutAt: at(10, 21, 40) };
    const rates = { baseCents: 3000, saturdayCents: null, sundayCents: null, nightCents: null, nightStartMin: null, nightEndMin: null };
    expect(shiftPay(worked(done), rates).paidMinutes).toBe(228);
    expect(clockedDifference(done)).toBe(-12);
    // Only clocked in: still the rostered 4 hours.
    expect(shiftPay(worked({ ...done, clockOutAt: null }), rates).paidMinutes).toBe(240);
  });
});

async function setup() {
  const db = await createTestDb();
  const wp = await createWorkplace(db, { name: 'Subway', defaultRateCents: 3000 });
  const add = (date: string, start: string, end: string, source: 'manual' | 'roster' = 'roster') =>
    createShift(db, { workplaceId: wp, date, startTime: start, endTime: end, unpaidBreakMinutes: 0, hourlyRateCents: 3000, source });
  return { db, wp, add };
}

describe('clocking in and out', () => {
  it('records times, completes the shift and allows corrections', async () => {
    const { db, add } = await setup();
    const id = await add('2026-11-10', '18:00', '22:00');
    expect((await getClockShift(db, at(10, 12)))?.id).toBe(id);

    await clockInShift(db, id, at(10, 17, 52));
    await expect(clockInShift(db, id, at(10, 17, 53))).rejects.toThrow(/already clocked in/);
    // Still the clock card's shift after its rostered end, until clocked out.
    expect((await getClockShift(db, at(10, 23)))?.id).toBe(id);
    await expect(clockOutShift(db, id, at(10, 17, 50))).rejects.toThrow(/after clock-in/);
    await clockOutShift(db, id, at(10, 21, 45));
    expect(await getShift(db, id)).toMatchObject({ status: 'completed', clockInAt: at(10, 17, 52), clockOutAt: at(10, 21, 45) });

    await setWorkedTimes(db, id, at(10, 18), at(10, 22));
    expect(await getShift(db, id)).toMatchObject({ status: 'completed', clockInAt: at(10, 18), clockOutAt: at(10, 22) });
    await setWorkedTimes(db, id, null, null);
    expect(await getShift(db, id)).toMatchObject({ status: 'scheduled', clockInAt: null });
    await expect(setWorkedTimes(db, id, null, at(10, 22))).rejects.toThrow(/clock-in time/);
  });
});

describe('roster updates', () => {
  const draft = (date: string, startTime: string, endTime: string): RosterDraft => ({ key: `${date}${startTime}`, date, startTime, endTime, source: '' });

  it('marks shifts new, same, changed and removed, then saves them', async () => {
    const { db, wp, add } = await setup();
    const same = await add('2026-11-09', '12:00', '16:00');
    const moved = await add('2026-11-10', '12:00', '16:00');
    const dropped = await add('2026-11-11', '12:00', '16:00');
    const mine = await add('2026-11-12', '09:00', '11:00', 'manual');
    await add('2026-11-20', '12:00', '16:00'); // a later week: not covered by this roster

    const existing = await listShiftsInRange(db, { start: '2026-11-01', end: '2026-12-01' });
    const changes = diffRoster(existing, [draft('2026-11-09', '12:00', '16:00'), draft('2026-11-10', '13:00', '17:00'), draft('2026-11-13', '18:00', '21:00')]);
    const summary = changes.map((c) => `${c.kind}:${'existing' in c ? c.existing.id : c.draft.date}`).sort();
    expect(summary).toEqual([`changed:${moved}`, `new:2026-11-13`, `removed:${dropped}`, `removed:${mine}`, `same:${same}`].sort());
    // A shift you added yourself isn't cancelled unless you tick it.
    const chosen = changes.filter(includedByDefault);
    expect(chosen.some((c) => c.kind === 'removed' && c.existing.id === mine)).toBe(false);

    const result = await applyRoster(db, chosen, { workplaceId: wp, hourlyRateCents: 3000, unpaidBreakMinutes: 0 }, at(8, 10));
    expect(result).toMatchObject({ added: 1, changed: 1, cancelled: 1 });
    expect(result.lines).toContain('Changed: Tue 10 Nov 12:00 PM – 4:00 PM → 1:00 PM – 5:00 PM');

    expect(await getShift(db, moved)).toMatchObject({ startAt: at(10, 13), previousStartAt: at(10, 12), changedAt: at(8, 10) });
    expect(await getShift(db, dropped)).toMatchObject({ status: 'cancelled' });
    expect(await getShift(db, mine)).toMatchObject({ status: 'scheduled' });
    const added = (await listShiftsInRange(db, { start: '2026-11-13', end: '2026-11-14' }))[0];
    expect(added).toMatchObject({ source: 'roster', startAt: at(13, 18) });
  });

  it('rolls everything back if one change can’t be saved', async () => {
    const { db, wp, add } = await setup();
    await add('2026-11-09', '12:00', '16:00', 'manual');
    const changes = diffRoster([], [draft('2026-11-10', '12:00', '16:00'), draft('2026-11-09', '13:00', '17:00')]);
    await expect(applyRoster(db, changes, { workplaceId: wp, hourlyRateCents: 3000, unpaidBreakMinutes: 0 })).rejects.toThrow(/overlaps/);
    expect(await listShiftsInRange(db, { start: '2026-11-10', end: '2026-11-11' })).toEqual([]);
  });
});

describe('clock reminders', () => {
  it('reminds when Clock In and Clock Out open, and if you forget to clock out', async () => {
    const { db, add } = await setup();
    const id = await add('2026-11-10', '18:00', '22:00');
    const prefs = {
      notificationsEnabled: true,
      shiftReminderMinutes: 60,
      remindAssessments: false,
      remindTasks: false,
      remindHabits: false,
      habitReminderTime: '20:00',
      remindClock: true,
      clockInEarlyMinutes: 10,
      clockOutEarlyMinutes: 30,
    };
    const kinds = async (now: number) => (await planReminders(db, prefs, now)).filter((r) => r.entityId === id).map((r) => [r.kind, new Date(r.fireAt).toTimeString().slice(0, 5)]);
    expect(await kinds(at(10, 9))).toEqual([
      ['before', '17:00'],
      ['clock_in', '17:50'],
      ['clock_out', '21:30'],
    ]);
    // Clock reminders off: only the usual "shift in 1 hour".
    expect((await planReminders(db, { ...prefs, remindClock: false }, at(10, 9))).map((r) => r.kind)).toEqual(['before']);
    await clockInShift(db, id, at(10, 17, 55));
    expect(await kinds(at(10, 18))).toEqual([
      ['clock_out', '21:30'],
      ['clock_out_late', '22:15'],
    ]);
    const clockOut = (await planReminders(db, prefs, at(10, 18))).find((r) => r.kind === 'clock_out');
    expect(clockOut).toMatchObject({ categoryId: 'clock-out', data: { shiftId: id } });
    await clockOutShift(db, id, at(10, 21, 40));
    expect(await kinds(at(10, 21, 41))).toEqual([]);
  });
});
