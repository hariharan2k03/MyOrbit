import { budgetStatus, compareToPrevious, savingsFor } from '@/features/finance/budgetMath';
import { habitStats } from '@/features/habits/streakMath';
import { gradeBand, requiredAverageFor, summariseGrades } from '@/features/study/gradeMath';
import { nextDueDate } from '@/features/tasks/recurrence';
import { computeShift, earningsFor, overlaps } from '@/features/work/shiftMath';
import { centsToInput, formatCents, parseMoneyToCents, sumCents } from '@/utils/money';
import { addMonths, customMonthRange, diffDays, formatClock, formatTime12, parseDateKey, parseTime, startOfWeek, toTimeValue } from '@/utils/time';

// Jest runs with TZ=Australia/Melbourne (see package.json) so DST cases are deterministic.

describe('money', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['$1,234.56', 123456],
    ['A$0.01', 1],
    [' 99.99 ', 9999],
  ])('parses %p to %p cents', (input, cents) => {
    expect(parseMoneyToCents(input)).toEqual({ ok: true, value: cents });
  });

  it.each(['', '-5', '1.234', 'abc', '1e5', '0', '123456789'])('rejects %p', (input) => {
    expect(parseMoneyToCents(input).ok).toBe(false);
  });

  it('avoids floating point drift', () => {
    // 0.1 + 0.2 !== 0.3 in floats; in cents it is exact.
    const a = parseMoneyToCents('0.10');
    const b = parseMoneyToCents('0.20');
    expect(a.ok && b.ok && sumCents([a.value, b.value])).toBe(30);
  });

  it('formats AUD', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(-2500)).toBe('-$25.00');
    expect(formatCents(100000000, { showCents: false })).toBe('$1,000,000');
    expect(formatCents(999, { masked: true })).toBe('$•••');
    expect(centsToInput(1250)).toBe('12.50');
  });
});

describe('time', () => {
  it('validates dates and times', () => {
    expect(parseDateKey('2026-02-29').ok).toBe(false);
    expect(parseDateKey('2028-02-29').ok).toBe(true);
    expect(parseTime('24:00').ok).toBe(false);
    expect(parseTime('9:00').ok).toBe(false);
    expect(parseTime('09:30')).toEqual({ ok: true, value: 570 });
  });

  it('clamps month arithmetic', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('counts calendar days across DST', () => {
    expect(diffDays('2026-04-04', '2026-04-06')).toBe(2);
    expect(diffDays('2026-10-03', '2026-10-05')).toBe(2);
  });

  it('uses Monday-based weeks', () => {
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02'); // Sunday → previous Monday
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02');
  });

  it('builds custom budget periods', () => {
    expect(customMonthRange('2026-11-20', 15)).toEqual({ start: '2026-11-15', end: '2026-12-15' });
    expect(customMonthRange('2026-11-03', 15)).toEqual({ start: '2026-10-15', end: '2026-11-15' });
    expect(() => customMonthRange('2026-11-03', 31)).toThrow();
  });
});

describe('shifts', () => {
  const base = { date: '2026-11-10', unpaidBreakMinutes: 30, hourlyRateCents: 3050 };

  it('calculates paid hours and earnings', () => {
    const r = computeShift({ ...base, startTime: '09:00', endTime: '17:00' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.durationMinutes).toBe(480);
    expect(r.value.paidMinutes).toBe(450);
    expect(r.value.estimatedEarningsCents).toBe(22875); // 7.5h × $30.50
    expect(r.value.overnight).toBe(false);
  });

  it('handles overnight shifts', () => {
    const r = computeShift({ ...base, startTime: '22:00', endTime: '06:00', unpaidBreakMinutes: 0 });
    expect(r.ok && r.value.overnight).toBe(true);
    expect(r.ok && r.value.durationMinutes).toBe(480);
  });

  it('uses real elapsed time when DST ends (clocks go back)', () => {
    const r = computeShift({ ...base, date: '2026-04-04', startTime: '22:00', endTime: '06:00', unpaidBreakMinutes: 0 });
    expect(r.ok && r.value.durationMinutes).toBe(540);
  });

  it('uses real elapsed time when DST starts (clocks go forward)', () => {
    const r = computeShift({ ...base, date: '2026-10-03', startTime: '22:00', endTime: '06:00', unpaidBreakMinutes: 0 });
    expect(r.ok && r.value.durationMinutes).toBe(420);
  });

  it.each([
    [{ startTime: '09:00', endTime: '09:00' }, 'same'],
    [{ startTime: '9am', endTime: '17:00' }, 'Start'],
    [{ startTime: '09:00', endTime: '10:00', unpaidBreakMinutes: 60 }, 'break'],
    [{ startTime: '06:00', endTime: '23:30' }, '16 hours'],
    [{ startTime: '09:00', endTime: '17:00', hourlyRateCents: 30.5 }, 'Hourly rate'],
    [{ startTime: '09:00', endTime: '17:00', date: '2026-13-01' }, 'Month'],
  ])('rejects invalid input %p', (patch, msg) => {
    const r = computeShift({ ...base, ...patch });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(msg);
  });

  it('rounds earnings to the nearest cent with integers', () => {
    expect(earningsFor(1, 3333)).toBe(56); // 55.55 → 56
    expect(earningsFor(7, 2913)).toBe(340); // 339.85 → 340
  });

  it('detects overlapping shifts', () => {
    expect(overlaps({ startAt: 0, endAt: 10 }, { startAt: 5, endAt: 15 })).toBe(true);
    expect(overlaps({ startAt: 0, endAt: 10 }, { startAt: 10, endAt: 15 })).toBe(false);
  });
});

describe('budgets', () => {
  it('reports levels and remaining amounts', () => {
    expect(budgetStatus(100000, 50000)).toMatchObject({ level: 'ok', remainingCents: 50000, usedBp: 5000 });
    expect(budgetStatus(100000, 85000).level).toBe('warning');
    expect(budgetStatus(100000, 100000).level).toBe('warning');
    expect(budgetStatus(100000, 100001)).toMatchObject({ level: 'over', remainingCents: -1 });
    expect(budgetStatus(0, 0).level).toBe('ok');
  });

  it('computes savings and comparisons', () => {
    expect(savingsFor({ incomeCents: 300000, expenseCents: 180050 })).toBe(119950);
    expect(compareToPrevious(12000, 10000)).toEqual({ deltaCents: 2000, changeBp: 2000 });
    expect(compareToPrevious(8000, 10000)).toEqual({ deltaCents: -2000, changeBp: -2000 });
    expect(compareToPrevious(5000, 0).changeBp).toBeNull();
  });
});

describe('grades', () => {
  it('separates confirmed and projected results', () => {
    const s = summariseGrades([
      { weightBp: 3000, markObtained: 24, markTotal: 30 }, // 80%
      { weightBp: 2000, markObtained: 14, markTotal: 20 }, // 70%
      { weightBp: 5000, markObtained: null, markTotal: null },
    ]);
    expect(s.confirmedPercent).toBe(38);
    expect(s.currentAveragePercent).toBe(76);
    expect(s.projectedPercent).toBe(76);
    expect(s.issues).toEqual([]);
    expect(requiredAverageFor(s, 80)).toBe(84);
    expect(requiredAverageFor(s, 95)).toBeNull();
    expect(gradeBand(76)).toBe('D');
  });

  it('flags bad weightings and incomplete marks', () => {
    const s = summariseGrades([
      { weightBp: 6000, markObtained: 10, markTotal: null },
      { weightBp: 5000, markObtained: 12, markTotal: 10 },
    ]);
    expect(s.issues).toHaveLength(3);
    expect(s.projectedPercent).toBeNull();
  });
});

describe('habits', () => {
  it('keeps a daily streak alive until a full day is missed', () => {
    const logs = ['2026-11-04', '2026-11-05', '2026-11-06'];
    expect(habitStats(logs, 'daily', 1, '2026-11-07')).toMatchObject({ currentStreak: 3, periodDone: false });
    expect(habitStats([...logs, '2026-11-07'], 'daily', 1, '2026-11-07').currentStreak).toBe(4);
    expect(habitStats(logs, 'daily', 1, '2026-11-08').currentStreak).toBe(0);
  });

  it('counts across DST without breaking', () => {
    const logs = ['2026-10-03', '2026-10-04', '2026-10-05'];
    expect(habitStats(logs, 'daily', 1, '2026-10-05')).toMatchObject({ currentStreak: 3, longestStreak: 3 });
  });

  it('tracks weekly targets', () => {
    const logs = ['2026-10-26', '2026-10-28', '2026-11-02', '2026-11-04', '2026-11-05'];
    expect(habitStats(logs, 'weekly', 2, '2026-11-07')).toMatchObject({ currentStreak: 2, periodCount: 3, periodDone: true });
  });
});

describe('recurring tasks', () => {
  it('advances without drift or backlog', () => {
    expect(nextDueDate('2026-11-07', 'daily', '2026-11-07')).toBe('2026-11-08');
    expect(nextDueDate('2026-11-01', 'weekly', '2026-11-07')).toBe('2026-11-08');
    expect(nextDueDate('2026-01-31', 'monthly', '2026-02-01')).toBe('2026-02-28');
    expect(nextDueDate('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-03-31');
    expect(nextDueDate('2026-11-07', 'none', '2026-11-07')).toBeNull();
  });
});

describe('12-hour clock', () => {
  it('formats display times in 12-hour format', () => {
    expect(formatTime12(0)).toBe('12:00 AM');
    expect(formatTime12(9 * 60)).toBe('9:00 AM');
    expect(formatTime12(12 * 60)).toBe('12:00 PM');
    expect(formatTime12(17 * 60 + 30)).toBe('5:30 PM');
    expect(formatTime12(23 * 60 + 59)).toBe('11:59 PM');
    expect(formatClock(new Date(2026, 10, 7, 18, 5).getTime())).toBe('6:05 PM');
  });

  it('keeps form values in 24-hour storage format', () => {
    expect(toTimeValue(new Date(2026, 10, 7, 18, 5).getTime())).toBe('18:05');
  });
});
