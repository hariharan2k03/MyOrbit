/**
 * Minimal, defensive iCalendar (RFC 5545) reader for timetable feeds.
 * Supports: line folding, escaped text, UTC / floating / TZID times,
 * all-day dates, DURATION, RRULE (DAILY, WEEKLY with BYDAY, MONTHLY by
 * day of month; INTERVAL, COUNT, UNTIL), EXDATE, RECURRENCE-ID overrides
 * and STATUS:CANCELLED. Anything it can't understand is skipped, not guessed.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  location: string | null;
  startAt: number;
  endAt: number;
  allDay: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface WallTime {
  y: number;
  mo: number; // 1–12
  d: number;
  h: number;
  mi: number;
  s: number;
}

type Zone = { kind: 'utc' } | { kind: 'floating' } | { kind: 'tz'; tz: string };

interface DateValue {
  wall: WallTime;
  zone: Zone;
  allDay: boolean;
}

/** Windows zone names used by Outlook/Exchange feeds, mapped to IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tasmania Standard Time': 'Australia/Hobart',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'GMT Standard Time': 'Europe/London',
  UTC: 'UTC',
};

const MAX_OCCURRENCES = 2000;
const DAY_MS = 86_400_000;

function unfold(text: string): string[] {
  return text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseProp(line: string): Prop | null {
  // Split at the first ':' that isn't inside a quoted parameter value.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: (rawName ?? '').toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
}

function resolveZone(tzid: string | undefined): Zone {
  if (!tzid) return { kind: 'floating' };
  const tz = WINDOWS_ZONES[tzid] ?? tzid.replace(/^\/+/, '');
  if (tz === 'UTC' || tz === 'Etc/UTC') return { kind: 'utc' };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return { kind: 'tz', tz };
  } catch {
    // Unknown zone name: treat as device-local wall time rather than dropping the event.
    return { kind: 'floating' };
  }
}

function parseDateValue(value: string, params: Record<string, string>): DateValue | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const wall: WallTime = { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  const allDay = m[4] === undefined || params.VALUE === 'DATE';
  if (allDay) return { wall: { ...wall, h: 0, mi: 0, s: 0 }, zone: { kind: 'floating' }, allDay: true };
  return { wall, zone: m[7] ? { kind: 'utc' } : resolveZone(params.TZID), allDay: false };
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
function tzOffset(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Wall-clock time in a zone → instant. Two passes settle DST boundaries. */
export function toInstant(wall: WallTime, zone: Zone): number {
  if (zone.kind === 'utc') return Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
  if (zone.kind === 'floating') return new Date(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s).getTime();
  const guess = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
  let t = guess - tzOffset(guess, zone.tz);
  t = guess - tzOffset(t, zone.tz);
  return t;
}

/** Calendar arithmetic on wall time (via UTC fields, so no DST skew). */
function addWallDays(w: WallTime, days: number): WallTime {
  const d = new Date(Date.UTC(w.y, w.mo - 1, w.d + days, w.h, w.mi, w.s));
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: w.h, mi: w.mi, s: w.s };
}

function wallDow(w: WallTime): number {
  return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface RawEvent {
  uid: string;
  title: string;
  location: string | null;
  start: DateValue;
  end: DateValue | null;
  durationMs: number | null;
  rrule: Record<string, string> | null;
  exdates: number[];
  recurrenceId: number | null;
  cancelled: boolean;
}

/** Expands a recurring event's start times (as wall times) within [from, to]. */
function expand(ev: RawEvent, from: number, to: number): WallTime[] {
  const start = ev.start.wall;
  if (!ev.rrule) return [start];
  const freq = ev.rrule.FREQ;
  const interval = Math.max(1, Number(ev.rrule.INTERVAL ?? 1) || 1);
  const count = ev.rrule.COUNT ? Number(ev.rrule.COUNT) : Infinity;
  const untilVal = ev.rrule.UNTIL ? parseDateValue(ev.rrule.UNTIL, {}) : null;
  const until = untilVal ? toInstant(untilVal.wall, untilVal.allDay ? { kind: 'floating' } : untilVal.zone) : Infinity;
  const zone = ev.start.allDay ? ({ kind: 'floating' } as Zone) : ev.start.zone;

  const out: WallTime[] = [];
  let produced = 0;
  const emit = (w: WallTime): boolean => {
    const t = toInstant(w, zone);
    if (t > until || produced >= count) return false;
    produced++;
    if (t >= from - DAY_MS && t <= to) out.push(w);
    return out.length < MAX_OCCURRENCES && t <= to;
  };

  if (freq === 'DAILY') {
    for (let i = 0; ; i += interval) if (!emit(addWallDays(start, i))) break;
  } else if (freq === 'WEEKLY') {
    const days = ev.rrule.BYDAY ? ev.rrule.BYDAY.split(',').map((d) => BYDAY[d.slice(-2)]).filter((d): d is number => d !== undefined) : [wallDow(start)];
    const weekStart = addWallDays(start, -wallDow(start)); // Sunday of the first week
    outer: for (let wk = 0; ; wk += interval) {
      for (const dow of [...days].sort((a, b) => a - b)) {
        const w = addWallDays(weekStart, wk * 7 + dow);
        if (toInstant(w, zone) < toInstant(start, zone)) continue;
        if (!emit(w)) break outer;
      }
      if (wk > 52 * 20) break;
    }
  } else if (freq === 'MONTHLY') {
    for (let i = 0; i < 12 * 20; i += interval) {
      const d = new Date(Date.UTC(start.y, start.mo - 1 + i, 1));
      const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      if (start.d > daysInMonth) continue; // e.g. the 31st skips short months, per RFC 5545
      if (!emit({ ...start, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1 })) break;
    }
  } else {
    return [start]; // Unsupported frequency: keep the first occurrence only.
  }
  return out;
}

export interface ParseOptions {
  /** Only occurrences overlapping [from, to] are returned. */
  from: number;
  to: number;
}

export function parseIcs(text: string, opts: ParseOptions): IcsEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('This link didn’t return a calendar (.ics) file.');
  const raws: RawEvent[] = [];
  let cur: Partial<RawEvent> & { exdates: number[] } | null = null;
  let depth = 0; // skip nested components such as VALARM

  for (const line of unfold(text)) {
    const p = parseProp(line);
    if (!p) continue;
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') {
      cur = { exdates: [], rrule: null, recurrenceId: null, cancelled: false, location: null, durationMs: null, end: null };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (p.name === 'BEGIN') {
      depth++;
      continue;
    }
    if (p.name === 'END') {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (p.value.toUpperCase() === 'VEVENT') {
        if (cur.start && cur.uid) raws.push({ title: '(No title)', ...cur } as RawEvent);
        cur = null;
      }
      continue;
    }
    if (depth > 0) continue;
    switch (p.name) {
      case 'UID':
        cur.uid = p.value.trim();
        break;
      case 'SUMMARY':
        cur.title = unescapeText(p.value).slice(0, 120) || '(No title)';
        break;
      case 'LOCATION':
        cur.location = unescapeText(p.value).slice(0, 120) || null;
        break;
      case 'DTSTART':
        cur.start = parseDateValue(p.value, p.params) ?? undefined;
        break;
      case 'DTEND':
        cur.end = parseDateValue(p.value, p.params);
        break;
      case 'DURATION':
        cur.durationMs = parseDuration(p.value);
        break;
      case 'RRULE':
        cur.rrule = Object.fromEntries(
          p.value.split(';').map((kv) => {
            const [k, v] = kv.split('=');
            return [(k ?? '').toUpperCase(), (v ?? '').toUpperCase()];
          }),
        );
        break;
      case 'EXDATE':
        for (const v of p.value.split(',')) {
          const dv = parseDateValue(v, p.params);
          if (dv) cur.exdates.push(toInstant(dv.wall, dv.allDay ? { kind: 'floating' } : dv.zone));
        }
        break;
      case 'RECURRENCE-ID': {
        const dv = parseDateValue(p.value, p.params);
        if (dv) cur.recurrenceId = toInstant(dv.wall, dv.allDay ? { kind: 'floating' } : dv.zone);
        break;
      }
      case 'STATUS':
        cur.cancelled = p.value.trim().toUpperCase() === 'CANCELLED';
        break;
    }
  }

  // Overrides (RECURRENCE-ID) replace the matching occurrence of their series.
  const overridden = new Map<string, Set<number>>();
  for (const r of raws) {
    if (r.recurrenceId === null) continue;
    const set = overridden.get(r.uid) ?? new Set<number>();
    set.add(r.recurrenceId);
    overridden.set(r.uid, set);
  }

  const events: IcsEvent[] = [];
  for (const r of raws) {
    const zone = r.start.allDay ? ({ kind: 'floating' } as Zone) : r.start.zone;
    const firstStart = toInstant(r.start.wall, zone);
    const length =
      r.end !== null
        ? toInstant(r.end.wall, r.end.allDay ? { kind: 'floating' } : r.end.zone) - firstStart
        : r.durationMs ?? (r.start.allDay ? DAY_MS : 0);
    const starts = r.recurrenceId !== null ? [r.start.wall] : expand(r, opts.from, opts.to);
    const skip = r.recurrenceId === null ? overridden.get(r.uid) : undefined;
    for (const w of starts) {
      const startAt = toInstant(w, zone);
      if (r.cancelled || r.exdates.includes(startAt) || skip?.has(startAt)) continue;
      // All-day events: end = start + same number of calendar days (DST-proof).
      const endAt = r.start.allDay ? toInstant(addWallDays(w, Math.max(1, Math.round(length / DAY_MS))), zone) : startAt + Math.max(0, length);
      if (endAt < opts.from || startAt > opts.to) continue;
      events.push({ uid: r.uid, title: r.title, location: r.location, startAt, endAt, allDay: r.start.allDay });
    }
  }
  return events.sort((a, b) => a.startAt - b.startAt);
}

/** Accepts https:// and webcal:// links; returns the https URL to fetch, or throws. */
export function normaliseFeedUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length > 2048) throw new Error('That link is too long.');
  const url = trimmed.replace(/^webcals?:\/\//i, 'https://');
  if (!/^https:\/\/[^\s/$.?#][^\s]*$/i.test(url)) throw new Error('Enter an https:// or webcal:// calendar link.');
  return url;
}
