import { err, ok, type Result } from './result';

/**
 * Calendar dates are stored as local `YYYY-MM-DD` keys, never as UTC midnight
 * timestamps, so a date never shifts when the device timezone changes.
 * Instants (shift start, activity end) are stored as epoch milliseconds.
 */
export type DateKey = string;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

export function parseDateKey(key: string): Result<{ year: number; month: number; day: number }> {
  const m = DATE_KEY_RE.exec(key);
  if (!m) return err('Date must be in YYYY-MM-DD format.');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2000 || year > 2100) return err('Year must be between 2000 and 2100.');
  if (month < 1 || month > 12) return err('Month must be between 1 and 12.');
  if (day < 1 || day > daysInMonth(year, month)) return err('That day does not exist in this month.');
  return ok({ year, month, day });
}

export function isValidDateKey(key: string): boolean {
  return parseDateKey(key).ok;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Parses `HH:mm` (24h) into minutes after midnight. */
export function parseTime(value: string): Result<number> {
  const m = TIME_RE.exec(value.trim());
  if (!m) return err('Time must be in 24-hour HH:mm format.');
  return ok(Number(m[1]) * 60 + Number(m[2]));
}

export function formatMinutesAsTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

/**
 * Builds a local Date from a date key and minutes after midnight. Using the
 * component constructor means the system timezone rules (including DST) decide
 * the instant. On a spring-forward gap (e.g. 02:30 when clocks jump 02:00→03:00)
 * the JS engine resolves forward, which matches iOS Calendar behaviour.
 */
export function localDateTime(key: DateKey, minutesAfterMidnight: number): Date {
  const parsed = parseDateKey(key);
  if (!parsed.ok) throw new Error(parsed.error);
  const { year, month, day } = parsed.value;
  return new Date(year, month - 1, day, Math.floor(minutesAfterMidnight / 60), minutesAfterMidnight % 60, 0, 0);
}

export function dateFromKey(key: DateKey): Date {
  return localDateTime(key, 0);
}

/** Adds calendar days (not 24h blocks), so DST days stay one calendar day. */
export function addDays(key: DateKey, days: number): DateKey {
  const d = dateFromKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Adds calendar months, clamping to the last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(key: DateKey, months: number): DateKey {
  const { year, month, day } = unwrapDate(key);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

/** Whole calendar days from `a` to `b` (positive when b is later). DST-safe. */
export function diffDays(a: DateKey, b: DateKey): number {
  const pa = unwrapDate(a);
  const pb = unwrapDate(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY_MS);
}

/** Monday-based week start by default (Australian convention). */
export function startOfWeek(key: DateKey, weekStartsOn: 0 | 1 = 1): DateKey {
  const dow = dateFromKey(key).getDay();
  const back = (dow - weekStartsOn + 7) % 7;
  return addDays(key, -back);
}

/**
 * The two-week pay period containing `key`. `anchor` is any date in a week
 * that starts a pay fortnight; periods run Monday to Sunday-week-after.
 */
export function fortnightRange(key: DateKey, anchor: DateKey): DateRange {
  const week = startOfWeek(key);
  const offset = (((diffDays(startOfWeek(anchor), week) % 14) + 14) % 14) as 0 | 7;
  const start = offset === 0 ? week : addDays(week, -7);
  return { start, end: addDays(start, 14) };
}

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`;
}

export interface DateRange {
  start: DateKey;
  /** Exclusive end. */
  end: DateKey;
}

export function weekRange(key: DateKey): DateRange {
  const start = startOfWeek(key);
  return { start, end: addDays(start, 7) };
}

export function monthRange(key: DateKey): DateRange {
  const start = startOfMonth(key);
  return { start, end: addMonths(start, 1) };
}

/**
 * Budget period that starts on `startDay` each month (e.g. the 15th to line up
 * with a pay cycle). `startDay` is limited to 1–28 so every month has it.
 */
export function customMonthRange(key: DateKey, startDay: number): DateRange {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new Error('Budget start day must be between 1 and 28.');
  }
  const { year, month, day } = unwrapDate(key);
  const thisStart = `${year}-${pad(month)}-${pad(startDay)}`;
  const start = day >= startDay ? thisStart : addMonths(thisStart, -1);
  return { start, end: addMonths(start, 1) };
}

export function isInRange(key: DateKey, range: DateRange): boolean {
  return key >= range.start && key < range.end;
}

export function eachDay(range: DateRange): DateKey[] {
  const days: DateKey[] = [];
  for (let k = range.start; k < range.end; k = addDays(k, 1)) days.push(k);
  return days;
}

function unwrapDate(key: DateKey) {
  const parsed = parseDateKey(key);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateKey(key: DateKey, opts: { weekday?: boolean } = {}): string {
  const d = dateFromKey(key);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return opts.weekday ? `${WEEKDAYS[d.getDay()]} ${base}` : base;
}

/** 12-hour display time, e.g. 0 → "12:00 AM", 1050 → "5:30 PM". */
export function formatTime12(minutesAfterMidnight: number): string {
  const h24 = Math.floor(minutesAfterMidnight / 60) % 24;
  const m = minutesAfterMidnight % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(m)} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** Displays an instant as local 12-hour time ("6:00 PM"). */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return formatTime12(d.getHours() * 60 + d.getMinutes());
}

/** An instant as a 24-hour `HH:mm` form value (storage format, not for display). */
export function toTimeValue(ms: number): string {
  const d = new Date(ms);
  return formatMinutesAsTime(d.getHours() * 60 + d.getMinutes());
}

/** "9:00 AM – 5:00 PM" */
export function formatTimeRange(startMs: number, endMs: number): string {
  return `${formatClock(startMs)} – ${formatClock(endMs)}`;
}

export function weekdayShort(key: DateKey): string {
  return WEEKDAYS[dateFromKey(key).getDay()]!;
}

export function monthLabel(key: DateKey): string {
  const { year, month } = unwrapDate(key);
  return `${MONTHS[month - 1]} ${year}`;
}

/** "Due today", "Due in 3 days", "Overdue" — by calendar day, not 24h blocks. */
export function dueLabel(dueAt: number, now: Date = new Date()): string {
  const days = diffDays(toDateKey(now), toDateKey(new Date(dueAt)));
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}
