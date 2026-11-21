import { addDays, dateFromKey, diffDays, startOfWeek, toDateKey, type DateKey } from '@/utils/time';

/**
 * Turns the text read from a roster photo/PDF into the user's own shifts.
 *
 * Input is what on-device text recognition returns: lines of text with their
 * position on the page (0–1, origin top-left). Rosters come in a few shapes:
 *
 *  - Team grid: one row per person, one column per day (most common).
 *  - Transposed grid: one column per person, one row per day.
 *  - List: a day heading, then "NAME 12:00-4:00" lines, or "Mon 10 Nov NAME 12-4".
 *  - Personal: only the user's shifts, often with no name at all.
 *
 * Everything here is pure so it can be tested with hand-made OCR output.
 */

export interface OcrLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page?: number;
  confidence?: number;
}

export interface ParsedRosterShift {
  date: DateKey;
  /** 24-hour "HH:mm". A finish earlier than the start means it ends the next day. */
  startTime: string;
  endTime: string;
  /** The roster text this shift was read from, shown so the user can check it. */
  source: string;
}

export type RosterLayout = 'grid' | 'columns' | 'list' | 'none';

export interface RosterParseResult {
  shifts: ParsedRosterShift[];
  /** Whether one of the user's names was found on the roster. */
  nameFound: boolean;
  layout: RosterLayout;
  /** Some days had only a weekday ("Mon"), so their dates came from the chosen week start. */
  usedWeekStart: boolean;
  /** The recognised text, row by row, for "Show what was read". */
  text: string;
  /** Some shifts ended at "Close" but the workplace has no closing time, so 10:00 PM was assumed. */
  closeTimeMissing: boolean;
}

export interface RosterParseOptions {
  /** The user's name as it appears on rosters, plus any variants ("HARIHARAN", "Hari"). */
  names: string[];
  today: DateKey;
  /** Monday (or first day) of the roster week, for rosters that only say "Mon", "Tue"… */
  weekStart?: DateKey;
  /** The workplace's closing time on a date (minutes after midnight), for shifts like "5-Close". */
  closeMinutes?: (date: DateKey) => number | null;
}

/** Used for "…-Close" when the workplace has no closing time set. */
export const DEFAULT_CLOSE_MIN = 22 * 60;

// ─── Times ──────────────────────────────────────────────────────────────────

interface ClockToken {
  h: number;
  m: number;
  suffix: 'am' | 'pm' | null;
  /** Written in 24-hour form ("18:00", "08:30", "1700"). */
  is24: boolean;
}

const TIME = String.raw`(\d{1,2}(?:[:.]\d{2})?|\d{3,4})\s*(a\.?m\.?|p\.?m\.?|a|p)?(?![a-z])`;
const RANGE_RE = new RegExp(String.raw`(?<![\d:.])${TIME}\s*(?:-|–|—|~|to|till|until)\s*${TIME}`, 'gi');
/** "5-Close", "4 - close (cook)": the end is the workplace's closing time that day. */
const CLOSE_RE = new RegExp(String.raw`(?<![\d:.])${TIME}\s*(?:-|–|—|~|to|till|until)\s*c[l1i][a-z]{0,3}\b`, 'gi');

/** A single clock time, used when a cell has start and finish on separate lines. */
const CLOCK_RE = /(?<![\d:./-])(\d{1,2})(?:[:.](\d{2}))\s*(a\.?m\.?|p\.?m\.?|a|p)?(?![\d:])|(?<![\d:./-])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi;

function parseClock(digits: string, suffixRaw: string | undefined): ClockToken | null {
  const suffix = suffixRaw ? (suffixRaw.toLowerCase().startsWith('a') ? 'am' : 'pm') : null;
  let h: number;
  let m = 0;
  const sep = digits.match(/^(\d{1,2})[:.](\d{2})$/);
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2]);
  } else if (/^\d{3,4}$/.test(digits)) {
    h = Number(digits.slice(0, -2));
    m = Number(digits.slice(-2));
  } else {
    h = Number(digits);
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || m > 59 || h > 24) return null;
  if (suffix && (h < 1 || h > 12)) return null;
  const is24 = !suffix && (h > 12 || h === 0 || /^0\d/.test(digits) || /^\d{4}$/.test(digits));
  return { h: h === 24 ? 0 : h, m, suffix, is24 };
}

function to24(t: ClockToken, suffix: 'am' | 'pm'): number {
  let h = t.h % 12;
  if (suffix === 'pm') h += 12;
  return h * 60 + t.m;
}

const span = (start: number, end: number) => (end - start + 1440) % 1440;
const MAX_SHIFT = 16 * 60;

/**
 * Picks the most plausible start/finish for two clock times, filling in a
 * missing am/pm. "12-4" → 12:00–16:00, "9-5" → 9:00–17:00, "6-10" → 18:00–22:00,
 * "11-3pm" → 11:00–15:00, "10pm-6" → 22:00–06:00.
 */
export function resolveRange(a: ClockToken, b: ClockToken): { start: number; end: number } | null {
  const options = (t: ClockToken, other: ClockToken): number[] => {
    if (t.suffix) return [to24(t, t.suffix)];
    if (t.is24 || other.is24) return [(t.h % 24) * 60 + t.m];
    return [to24(t, 'am'), to24(t, 'pm')];
  };
  const starts = options(a, b);
  const ends = options(b, a);
  let best: { start: number; end: number; score: number } | null = null;
  for (const start of starts) {
    for (const end of ends) {
      const d = span(start, end);
      if (d === 0 || d > MAX_SHIFT) continue;
      // Shorter is more plausible; with no am/pm at all, starts between 7 AM and
      // 6:59 PM are favoured so "6-10" reads as an evening shift, "7-3" as a day shift.
      let score = d;
      if (starts.length > 1 && (start < 7 * 60 || start >= 19 * 60)) score += 6 * 60;
      if (!best || score < best.score) best = { start, end, score };
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

/** "5-Close" with close at 22:30 → 17:00 (the shortest shift that fits), "11-Close" → 11:00. */
export function resolveCloseStart(t: ClockToken, closeMin: number): number | null {
  const starts = t.suffix ? [to24(t, t.suffix)] : t.is24 ? [(t.h % 24) * 60 + t.m] : [to24(t, 'am'), to24(t, 'pm')];
  let best: number | null = null;
  for (const start of starts) {
    const d = span(start, closeMin);
    if (d === 0 || d > MAX_SHIFT) continue;
    if (best === null || d < span(best, closeMin)) best = start;
  }
  return best;
}

export const minutesToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Common OCR slips inside numbers: O→0, l/I/|→1, S→5 between digits. */
function cleanDigits(text: string): string {
  return text
    .replace(/(?<=\d[:.]?)[Oo](?=[\d\s:.apAP-]|$)/g, '0')
    .replace(/(?<=[\d:])[Oo]/g, '0')
    .replace(/[lI|](?=\d[:.]?\d)/g, '1')
    .replace(/(?<=\d)[lI|](?=[:.]\d)/g, '1')
    .replace(/\bnoon\b/gi, '12pm')
    .replace(/\bmidnight\b/gi, '12am');
}

// ─── Dates ──────────────────────────────────────────────────────────────────

export interface DateInfo {
  /** 0 = Sunday … 6 = Saturday */
  weekday?: number;
  day?: number;
  month?: number;
  year?: number;
}

const WEEKDAY = String.raw`(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const ORD = String.raw`(?:st|nd|rd|th)?`;

const NUMERIC_DATE_RE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?\b|\b(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\b/g;
const TEXT_DATE_RE = new RegExp(
  String.raw`\b(${WEEKDAY})\.?\b(?:[\s,]*(\d{1,2})${ORD}\b)?(?:[\s,-]*(${MONTH})\.?\b)?(?:[\s,]*(\d{4})\b)?` +
    String.raw`|\b(\d{1,2})${ORD}[\s-]*(${MONTH})\.?\b(?:[\s,-]*(\d{4})\b)?` +
    String.raw`|\b(${MONTH})\.?[\s-]*(\d{1,2})${ORD}\b(?:,?\s*(\d{4})\b)?`,
  'gi',
);

const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const weekdayOf = (s: string) => WEEKDAY_INDEX[s.slice(0, 3).toLowerCase()];
const monthOf = (s: string) => MONTH_INDEX[s.slice(0, 3).toLowerCase()];
const fullYear = (y: string | undefined) => (y === undefined ? undefined : y.length === 2 ? 2000 + Number(y) : Number(y));

function validDayMonth(d: DateInfo): boolean {
  return (d.day === undefined || (d.day >= 1 && d.day <= 31)) && (d.month === undefined || (d.month >= 1 && d.month <= 12));
}

/** Finds a date nearest to today that matches what the roster says. */
export function resolveDate(info: DateInfo, today: DateKey, weekStart: DateKey | undefined): { date: DateKey; usedWeekStart: boolean } | null {
  const ref = dateFromKey(today);
  if (info.day !== undefined && info.month !== undefined) {
    const years = info.year !== undefined ? [info.year] : [ref.getFullYear() - 1, ref.getFullYear(), ref.getFullYear() + 1];
    let best: DateKey | null = null;
    for (const y of years) {
      const d = new Date(y, info.month - 1, info.day);
      if (d.getMonth() !== info.month - 1) continue;
      const key = toDateKey(d);
      if (!best || Math.abs(diffDays(today, key)) < Math.abs(diffDays(today, best))) best = key;
    }
    return best ? { date: best, usedWeekStart: false } : null;
  }
  if (info.day !== undefined) {
    // "Mon 10": the nearest date with that day of the month (and weekday, if given).
    for (let i = 0; i <= 75; i++) {
      for (const k of i === 0 ? [0] : [i, -i]) {
        const key = addDays(today, k);
        const d = dateFromKey(key);
        if (d.getDate() === info.day && (info.weekday === undefined || d.getDay() === info.weekday)) return { date: key, usedWeekStart: false };
      }
    }
    return null;
  }
  if (info.weekday !== undefined) {
    const start = weekStart ?? defaultWeekStart(today);
    const offset = (info.weekday - dateFromKey(start).getDay() + 7) % 7;
    return { date: addDays(start, offset), usedWeekStart: true };
  }
  return null;
}

/** Rosters are usually for the coming week: from Thursday on, assume next week. */
export function defaultWeekStart(today: DateKey): DateKey {
  const monday = startOfWeek(today, 1);
  const wd = dateFromKey(today).getDay();
  return wd === 0 || wd >= 4 ? addDays(monday, 7) : monday;
}

// ─── Names ──────────────────────────────────────────────────────────────────

const letters = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** OCR misreads a letter now and then (HARlHARAN, HARIHARN), so long names may differ slightly. */
function sameName(word: string, alias: string): boolean {
  if (word === alias) return true;
  if (alias.length < 5) return false;
  const allowed = alias.length >= 9 ? 2 : 1;
  // OCR reads I as l/1 and O as 0; compare on a folded alphabet first.
  const fold = (s: string) => s.replace(/[L1]/g, 'I').replace(/0/g, 'O');
  return editDistance(fold(word), fold(alias), allowed) <= allowed;
}

/** Returns the character span of a name match in the text, or null. */
export function findName(text: string, names: string[]): { start: number; end: number } | null {
  const aliases = names.map(letters).filter((a) => a.length >= 3);
  if (aliases.length === 0) return null;
  const words = [...text.matchAll(/[A-Za-z][A-Za-z'.-]*/g)].map((m) => ({ w: letters(m[0]), start: m.index, end: m.index + m[0].length }));
  for (const alias of aliases) {
    for (let i = 0; i < words.length; i++) {
      // A name may be split over words ("HARI HARAN") or joined ("HARIHARAN").
      let joined = '';
      for (let j = i; j < Math.min(words.length, i + 3); j++) {
        joined += words[j]!.w;
        if (sameName(joined, alias)) return { start: words[i]!.start, end: words[j]!.end };
        if (joined.length > alias.length + 2) break;
      }
    }
  }
  return null;
}

// ─── Pieces: the parts of each line, with an estimated position ──────────────

type PieceKind = 'range' | 'clock' | 'date' | 'name' | 'off';

interface Piece {
  kind: PieceKind;
  line: number;
  /** Character span within the (cleaned) line text. */
  cs: number;
  ce: number;
  x0: number;
  x1: number;
  xc: number;
  yc: number;
  h: number;
  text: string;
  range?: { start: number; end: number };
  /** For "…-Close": the start time; the end comes from the closing time that day. */
  closeStart?: ClockToken;
  clock?: ClockToken;
  date?: DateInfo;
}

const OFF_RE = /\b(?:off|rdo|leave|a\/l|annual leave|sick|unavailable|n\/a)\b/gi;

function piecesOf(lines: OcrLine[], names: string[]): Piece[] {
  const out: Piece[] = [];
  lines.forEach((line, li) => {
    const text = cleanDigits(line.text);
    const blank = text.split('');
    const len = Math.max(text.length, 1);
    const add = (kind: PieceKind, start: number, end: number, extra: Partial<Piece> = {}) => {
      // Within a merged line, position is estimated from the character offset.
      const x0 = line.x + (line.width * start) / len;
      const x1 = line.x + (line.width * end) / len;
      out.push({ kind, line: li, cs: start, ce: end, x0, x1, xc: (x0 + x1) / 2, yc: line.y + line.height / 2, h: line.height, text: text.slice(start, end), ...extra });
      for (let i = start; i < end; i++) blank[i] = ' ';
    };
    const remaining = () => blank.join('');

    for (const m of text.matchAll(NUMERIC_DATE_RE)) {
      const info: DateInfo = m[1]
        ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
        : m[4]
          ? { day: Number(m[4]), month: Number(m[5]), year: fullYear(m[6]) }
          : { day: Number(m[7]), month: Number(m[8]), year: fullYear(m[9]) };
      // "12.30" alone is a time, not 12 March; dotted dates need a year.
      if (m[4] && m[0].includes('.') && !m[6]) continue;
      if (validDayMonth(info)) add('date', m.index, m.index + m[0].length, { date: info });
    }
    for (const m of remaining().matchAll(RANGE_RE)) {
      const a = parseClock(m[1]!, m[2]);
      const b = parseClock(m[3]!, m[4]);
      const r = a && b ? resolveRange(a, b) : null;
      if (r) add('range', m.index, m.index + m[0].length, { range: r });
    }
    for (const m of remaining().matchAll(CLOSE_RE)) {
      const a = parseClock(m[1]!, m[2]);
      if (a) add('range', m.index, m.index + m[0].length, { closeStart: a });
    }
    for (const m of remaining().matchAll(TEXT_DATE_RE)) {
      const info: DateInfo = m[1]
        ? { weekday: weekdayOf(m[1]), day: m[2] ? Number(m[2]) : undefined, month: m[3] ? monthOf(m[3]) : undefined, year: fullYear(m[4]) }
        : m[5]
          ? { day: Number(m[5]), month: monthOf(m[6]!), year: fullYear(m[7]) }
          : { month: monthOf(m[8]!), day: Number(m[9]), year: fullYear(m[10]) };
      if (validDayMonth(info)) add('date', m.index, m.index + m[0].length, { date: info });
    }
    for (const m of remaining().matchAll(CLOCK_RE)) {
      const c = m[1] ? parseClock(`${m[1]}:${m[2]}`, m[3]) : parseClock(m[4]!, m[5]);
      if (c) add('clock', m.index, m.index + m[0].length, { clock: c });
    }
    const name = findName(remaining(), names);
    if (name) add('name', name.start, name.end);
    for (const m of remaining().matchAll(OFF_RE)) add('off', m.index, m.index + m[0].length);
  });
  const merged = mergeAdjacentDates(out, lines);
  // A header cell like "Mon (9.30 PM)" or "16-Nov" names one day: use the whole
  // cell's width for its position, not just the characters of the date.
  const byLine = new Map<number, Piece[]>();
  for (const p of merged) byLine.set(p.line, [...(byLine.get(p.line) ?? []), p]);
  for (const [li, ps] of byLine) {
    const dates = ps.filter((p) => p.kind === 'date');
    if (dates.length !== 1 || ps.some((p) => p.kind === 'range' || p.kind === 'name')) continue;
    const l = lines[li]!;
    dates[0]!.x0 = l.x;
    dates[0]!.x1 = l.x + l.width;
    dates[0]!.xc = l.x + l.width / 2;
  }
  return merged;
}


/** "Mon" + "10/11" read as separate tokens on one line become one date. */
function mergeAdjacentDates(pieces: Piece[], lines: OcrLine[]): Piece[] {
  const out: Piece[] = [];
  const sorted = [...pieces].sort((a, b) => a.line - b.line || a.x0 - b.x0);
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && p.kind === 'date' && prev.kind === 'date' && prev.line === p.line) {
      const between = cleanDigits(lines[p.line]!.text).slice(prev.ce, p.cs);
      const a = prev.date!;
      const b = p.date!;
      const compatible = (a.day === undefined || b.day === undefined) && (a.weekday === undefined || b.weekday === undefined);
      if (compatible && /^[\s,.-]*$/.test(between)) {
        prev.date = { weekday: a.weekday ?? b.weekday, day: a.day ?? b.day, month: a.month ?? b.month, year: a.year ?? b.year };
        prev.x1 = p.x1;
        prev.ce = p.ce;
        prev.xc = (prev.x0 + prev.x1) / 2;
        prev.text = `${prev.text} ${p.text}`;
        continue;
      }
    }
    out.push({ ...p });
  }
  return out;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Groups items into rows by vertical position. */
function rowsOf<T extends { yc: number; h: number }>(items: T[], tolFactor = 0.6): T[][] {
  const sorted = [...items].sort((a, b) => a.yc - b.yc);
  const rows: { yc: number; h: number; items: T[] }[] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.yc - row.yc) <= tolFactor * Math.max(it.h, row.h)) {
      row.items.push(it);
      row.yc = row.items.reduce((s, x) => s + x.yc, 0) / row.items.length;
    } else {
      rows.push({ yc: it.yc, h: it.h, items: [it] });
    }
  }
  return rows.map((r) => r.items);
}

/** Least-squares slope dy/dx, to follow rows across a photo taken at an angle. */
function slopeOf(points: { xc: number; yc: number }[]): number {
  if (points.length < 2) return 0;
  const mx = points.reduce((s, p) => s + p.xc, 0) / points.length;
  const my = points.reduce((s, p) => s + p.yc, 0) / points.length;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.xc - mx) * (p.yc - my);
    den += (p.xc - mx) ** 2;
  }
  const s = den === 0 ? 0 : num / den;
  return Math.abs(s) > 0.5 ? 0 : s;
}

// ─── Layouts ────────────────────────────────────────────────────────────────

type CellTime = { start: number; end: number; source: string } | { closeStart: ClockToken; source: string };
type Found = { date: DateInfo } & CellTime;

const timeOf = (p: Piece): CellTime => (p.closeStart ? { closeStart: p.closeStart, source: p.text } : { ...p.range!, source: p.text });

/**
 * Every shift in one cell — usually one range, but split shifts ("11-4.00/" over
 * "5-Close") have two — or two clock times stacked on separate lines.
 */
function cellTimes(inCell: Piece[]): CellTime[] {
  const sorted = [...inCell].sort((a, b) => a.yc - b.yc || a.x0 - b.x0);
  const ranges = sorted.filter((p) => p.kind === 'range');
  if (ranges.length) return ranges.map(timeOf);
  const clocks = sorted.filter((p) => p.kind === 'clock').slice(0, 2);
  if (clocks.length === 2) {
    const r = resolveRange(clocks[0]!.clock!, clocks[1]!.clock!);
    if (r) return [{ ...r, source: `${clocks[0]!.text}–${clocks[1]!.text}` }];
  }
  return [];
}

/** The nearest pieces to `targetY` (within tol), keeping all those at about the same distance. */
function nearestCell(candidates: Piece[], targetY: number, tol: number): Piece[] {
  const near = candidates.filter((p) => Math.abs(p.yc - targetY) <= tol);
  if (near.some((p) => p.kind === 'off') && !near.some((p) => p.kind === 'range')) return [];
  return near;
}

/**
 * The vertical band of the user's row: from just below the name above to just
 * below their own name (or halfway to the next). Spreadsheet rosters put names
 * at the bottom of tall cells, with a split shift's first line above the name,
 * so the band reaches further up than down.
 */
function rowBand(name: Piece, lines: OcrLine[], lineH: number): { top: number; bottom: number } {
  const nameLine = lines[name.line]!;
  const column = lines
    .filter((l) => l !== nameLine && Math.abs(l.x - nameLine.x) < 0.03)
    .map((l) => l.y + l.height / 2);
  const above = column.filter((y) => y < name.yc - lineH * 0.4);
  const below = column.filter((y) => y > name.yc + lineH * 0.4);
  const prev = above.length ? Math.max(...above) : null;
  const next = below.length ? Math.min(...below) : null;
  // The row above ends just below its name (its cells sit level with or above it).
  const top = prev !== null ? Math.min(prev + lineH * 0.6, name.yc - lineH * 0.6) : name.yc - lineH * 2.2;
  const bottom = Math.min(name.yc + lineH * 0.75, next !== null ? (next + name.yc) / 2 : Infinity);
  return { top, bottom };
}

/** Team grid: days across the top, the user's row below. */
function fromGrid(pieces: Piece[], name: Piece, lineH: number, lines: OcrLine[]): Found[] | null {
  const headers = rowsOf(pieces.filter((p) => p.kind === 'date' && p.yc < name.yc - lineH * 0.4)).filter((r) => r.length >= 3);
  // The header nearest above this name (a fortnight roster has one per week).
  const byNearest = headers.sort((a, b) => median(b.map((p) => p.yc)) - median(a.map((p) => p.yc)));
  const header = byNearest[0];
  if (!header) return null;
  const cols = [...header].sort((a, b) => a.xc - b.xc).map((p) => ({ ...p, date: { ...p.date! } }));

  // A second header row just above ("16-Nov" over "Mon (9.30 PM)") fills in
  // whatever this one lacks — usually the dates for a weekday-only row.
  const second = byNearest[1];
  if (second && median(header.map((p) => p.yc)) - median(second.map((p) => p.yc)) < lineH * 5) {
    for (const extra of second) {
      const i = cols.findIndex((c, k) => extra.xc >= c.x0 - lineH && (k === cols.length - 1 || extra.xc < cols[k + 1]!.x0));
      const col = cols[i];
      if (!col) continue;
      const d = extra.date!;
      col.date = { weekday: col.date.weekday ?? d.weekday, day: col.date.day ?? d.day, month: col.date.month ?? d.month, year: col.date.year ?? d.year };
    }
  }

  const pitch = median(cols.slice(1).map((c, i) => c.xc - cols[i]!.xc)) || 0.1;
  const slope = slopeOf(cols);
  const band = rowBand(name, lines, lineH);
  const cells = pieces.filter((p) => (p.kind === 'range' || p.kind === 'clock' || p.kind === 'off') && p.xc > name.x1 - pitch * 0.2);
  const out: Found[] = [];
  for (const col of cols) {
    // Follow the header's tilt from the name across to this column.
    const dy = slope * (col.xc - name.xc);
    const inCell = cells.filter((p) => {
      const nearest = cols.reduce((best, c) => (Math.abs(c.xc - p.xc) < Math.abs(best.xc - p.xc) ? c : best));
      return nearest === col && Math.abs(p.xc - col.xc) <= pitch * 0.75 && p.yc > band.top + dy && p.yc <= band.bottom + dy;
    });
    if (inCell.some((p) => p.kind === 'off') && !inCell.some((p) => p.kind === 'range')) continue;
    for (const t of cellTimes(inCell)) out.push({ date: col.date, ...t });
  }
  return out;
}

/** Transposed grid: names across the top, days down the left. */
function fromColumns(pieces: Piece[], name: Piece, lineH: number, lines: OcrLine[]): Found[] | null {
  const days = pieces.filter((p) => p.kind === 'date' && p.yc > name.yc + lineH * 0.4 && p.x1 <= name.x0 + 0.02);
  if (rowsOf(days).length < 2) return null;
  // Other names in the header row bound this person's column.
  const neighbours = lines
    .map((l) => ({ xc: l.x + l.width / 2, yc: l.y + l.height / 2 }))
    .filter((l) => Math.abs(l.yc - name.yc) <= lineH * 0.6 && Math.abs(l.xc - name.xc) > 0.01);
  const leftGap = Math.min(...neighbours.filter((n) => n.xc < name.xc).map((n) => name.xc - n.xc), 1);
  const rightGap = Math.min(...neighbours.filter((n) => n.xc > name.xc).map((n) => n.xc - name.xc), 1);
  const cells = pieces.filter((p) => (p.kind === 'range' || p.kind === 'clock' || p.kind === 'off') && p.xc > name.xc - leftGap / 2 && p.xc < name.xc + rightGap / 2);
  const dayRows = rowsOf(days).map((r) => r.sort((a, b) => a.x0 - b.x0)[0]!);
  const pitch = median(dayRows.slice(1).map((d, i) => d.yc - dayRows[i]!.yc)) || lineH * 3;
  const tol = Math.min(lineH * 1.3, pitch * 0.5);
  const out: Found[] = [];
  for (const day of dayRows) {
    for (const t of cellTimes(nearestCell(cells, day.yc, tol))) out.push({ date: day.date!, ...t });
  }
  return out;
}

/** Lists and personal rosters, read top to bottom. */
function fromList(pieces: Piece[], onlyNameRows: boolean): Found[] {
  const out: Found[] = [];
  let context: DateInfo | null = null;
  for (const row of rowsOf(pieces)) {
    const sorted = row.sort((a, b) => a.x0 - b.x0);
    if (sorted.filter((p) => p.kind === 'date').length >= 3) return [];
    const date = sorted.find((p) => p.kind === 'date');
    const ranges = sorted.filter((p) => p.kind === 'range');
    if (date) context = date.date!;
    if (ranges.length === 0 || !context) continue;
    if (onlyNameRows && !sorted.some((p) => p.kind === 'name')) continue;
    for (const r of ranges) out.push({ date: context, ...timeOf(r) });
  }
  return out;
}

/**
 * A photo taken at an angle makes rows slope. The slope is measured between
 * each line and its nearest neighbour to the right, and taken out of every
 * position, so rows are level again before anything is grouped.
 */
function deskew(lines: OcrLine[]): OcrLine[] {
  const h = median(lines.map((l) => l.height)) || 0.02;
  const centre = (l: OcrLine) => ({ x: l.x + l.width / 2, y: l.y + l.height / 2 });
  const slopes: number[] = [];
  for (const l of lines) {
    const a = centre(l);
    // Nearest to the right, preferring the most level one when two are equally close.
    let best: { dx: number; dy: number; score: number } | null = null;
    for (const o of lines) {
      if (o === l || (o.page ?? 0) !== (l.page ?? 0)) continue;
      const b = centre(o);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (o.x <= l.x + l.width * 0.5 || dx < 0.02 || Math.abs(dy) > h * 2.5) continue;
      const score = dx + 3 * Math.abs(dy);
      if (!best || score < best.score) best = { dx, dy, score };
    }
    if (best) slopes.push(best.dy / best.dx);
  }
  const slope = median(slopes);
  if (slopes.length < 3 || Math.abs(slope) < 0.002 || Math.abs(slope) > 0.3) return lines;
  return lines.map((l) => ({ ...l, y: l.y - slope * (l.x + l.width / 2 - 0.5) }));
}

export function parseRoster(lines: OcrLine[], opts: RosterParseOptions): RosterParseResult {
  const clean = deskew(lines.filter((l) => l.text.trim() && l.width > 0 && l.height > 0));
  const pieces = piecesOf(clean, opts.names);
  const lineH = median(clean.map((l) => l.height)) || 0.02;
  const text = rowsOf(clean.map((l) => ({ ...l, yc: l.y + l.height / 2, h: l.height })))
    .map((r) => r.sort((a, b) => a.x - b.x).map((l) => l.text).join('   '))
    .join('\n');

  const names = pieces.filter((p) => p.kind === 'name');
  let found: Found[] = [];
  let layout: RosterLayout = 'none';
  for (const name of names) {
    const grid = fromGrid(pieces, name, lineH, clean);
    if (grid && grid.length > 0) {
      found.push(...grid);
      layout = 'grid';
      continue;
    }
    const cols = fromColumns(pieces, name, lineH, clean);
    if (cols && cols.length > 0) {
      found.push(...cols);
      layout = 'columns';
    }
  }
  if (found.length === 0) {
    // A name on a row with times means a shared list: keep only those rows.
    // Otherwise (no name, or the name only in a title) every shift is the user's.
    const nameRowsHaveTimes = rowsOf(pieces).some((r) => r.some((p) => p.kind === 'name') && r.some((p) => p.kind === 'range'));
    found = fromList(pieces, nameRowsHaveTimes);
    if (found.length > 0) layout = 'list';
  }

  let usedWeekStart = false;
  let closeTimeMissing = false;
  const seen = new Set<string>();
  const shifts: ParsedRosterShift[] = [];
  for (const f of found) {
    const r = resolveDate(f.date, opts.today, opts.weekStart);
    if (!r || Math.abs(diffDays(opts.today, r.date)) > 120) continue;
    let start: number;
    let end: number;
    if ('closeStart' in f) {
      const close = opts.closeMinutes?.(r.date) ?? null;
      if (close === null) closeTimeMissing = true;
      end = close ?? DEFAULT_CLOSE_MIN;
      const st = resolveCloseStart(f.closeStart, end);
      if (st === null) continue;
      start = st;
    } else {
      start = f.start;
      end = f.end;
    }
    usedWeekStart ||= r.usedWeekStart;
    const s = { date: r.date, startTime: minutesToHHMM(start), endTime: minutesToHHMM(end), source: f.source.trim() };
    const key = `${s.date} ${s.startTime} ${s.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    shifts.push(s);
  }
  shifts.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
  return { shifts, nameFound: names.length > 0, layout, usedWeekStart, text, closeTimeMissing };
}
