import { createExpense, createIncome, INCOME_CATEGORIES, type ExpenseCategory, type IncomeCategory } from '@/database/repositories/finance';
import { createTask } from '@/database/repositories/tasks';
import { createShift, type Workplace } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { formatCents, type Cents } from '@/utils/money';
import { addDays, dateFromKey, formatDateKey, formatTime12, isValidDateKey, parseTime, type DateKey } from '@/utils/time';

/** What the on-device model extracted, exactly as returned by the native module. */
export interface RawDraft {
  kind: string;
  title: string;
  dateText: string;
  startTime: string;
  endTime: string;
  amount: number;
  category: string;
}

export type QuickAddDraft =
  | { kind: 'shift'; workplace: Workplace; date: DateKey; startTime: string; endTime: string }
  | { kind: 'task'; title: string; dueDate: DateKey | null }
  | { kind: 'expense'; description: string; amountCents: Cents; category: ExpenseCategory; date: DateKey }
  | { kind: 'income'; source: string; amountCents: Cents; category: IncomeCategory; date: DateKey; workplaceId: number | null };

export type Resolved = { ok: true; draft: QuickAddDraft } | { ok: false; message: string };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Turns "Sat", "tomorrow", "12 Nov", "12/11" or "2026-11-12" into a date.
 * A bare weekday means the next one on or after today; "next Sat" skips today.
 * Numeric dates are day/month, as in Australia. Returns null if unclear.
 */
export function resolveDate(text: string, today: DateKey): DateKey | null {
  const t = text.trim().toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ');
  if (!t) return null;
  if (t === 'today' || t === 'tonight') return today;
  if (t === 'tomorrow' || t === 'tmrw' || t === 'tomorrow night') return addDays(today, 1);
  if (t === 'yesterday') return addDays(today, -1);
  if (isValidDateKey(t)) return t;

  const wd = /^(next |this )?([a-z]+)$/.exec(t);
  if (wd) {
    const idx = WEEKDAYS.findIndex((d) => d === wd[2] || (wd[2]!.length >= 3 && d.startsWith(wd[2]!)));
    if (idx >= 0) {
      const current = dateFromKey(today).getDay();
      let ahead = (idx - current + 7) % 7;
      if (ahead === 0 && wd[1] === 'next ') ahead = 7;
      return addDays(today, ahead);
    }
  }

  // "Sat 7 Nov" / "Saturday, 7 November 2026": the weekday is redundant next to a date.
  const dated = /^([a-z]+) (\d.*|[a-z]+ \d.*)$/.exec(t);
  if (dated && WEEKDAYS.some((d) => d === dated[1] || (dated[1]!.length >= 3 && d.startsWith(dated[1]!)))) {
    return resolveDate(dated[2]!, today);
  }

  const year = Number(today.slice(0, 4));
  const build = (d: number, m: number, y?: number) => {
    const key = (yy: number) => `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (y !== undefined) return isValidDateKey(key(y)) ? key(y) : null;
    // No year: the next time that date comes round (allowing a few weeks back for late entries).
    const k = key(year);
    if (!isValidDateKey(k)) return null;
    return k < addDays(today, -60) ? (isValidDateKey(key(year + 1)) ? key(year + 1) : null) : k;
  };
  let m = /^(\d{1,2}) ?([a-z]{3,})(?: (\d{4}))?$/.exec(t) ?? null;
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.slice(0, 3));
    return mi >= 0 ? build(Number(m[1]), mi + 1, m[3] ? Number(m[3]) : undefined) : null;
  }
  m = /^([a-z]{3,}) (\d{1,2})(?: (\d{4}))?$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3));
    return mi >= 0 ? build(Number(m[2]), mi + 1, m[3] ? Number(m[3]) : undefined) : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    return build(Number(m[1]), Number(m[2]), y);
  }
  return null;
}

/** Accepts "09:00", "9", "9:30", "9am", "5 pm". Returns minutes after midnight, or null. */
export function resolveTime(text: string): { minutes: number; meridiem: boolean } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  const mer = m[3]?.[0];
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'p' && h !== 12) h += 12;
    if (mer === 'a' && h === 12) h = 0;
  } else if (h > 23) return null;
  return { minutes: h * 60 + min, meridiem: Boolean(mer) };
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** Best match by name, ignoring case and spaces ("woolies" won't match; "woolworths metro" will). */
function matchByName<T extends { name: string }>(items: T[], text: string): T | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const q = norm(text);
  if (!q) return undefined;
  return items.find((i) => norm(i.name) === q) ?? items.find((i) => norm(i.name).includes(q) || q.includes(norm(i.name)));
}

/**
 * Checks and completes what the model extracted. Nothing is saved here; the
 * screen shows the result for the user to confirm first.
 */
export function resolveDraft(raw: RawDraft, ctx: { today: DateKey; workplaces: Workplace[]; categories: ExpenseCategory[] }): Resolved {
  const kind = raw.kind.trim().toLowerCase();
  const title = raw.title.trim().slice(0, 120);
  const date = resolveDate(raw.dateText, ctx.today);
  if (raw.dateText.trim() && !date) return { ok: false, message: `I couldn’t work out the date “${raw.dateText.trim()}”. Try “Sat” or “12 Nov”.` };

  if (kind === 'shift') {
    const workplace = matchByName(ctx.workplaces.filter((w) => !w.archived), title);
    if (!workplace) {
      return { ok: false, message: title ? `“${title}” isn’t one of your workplaces. Add it in Work → Workplaces & Pay Rates first.` : 'Which workplace is the shift at?' };
    }
    const s = resolveTime(raw.startTime);
    const e = resolveTime(raw.endTime);
    if (!s || !e) return { ok: false, message: 'Add the start and finish times, e.g. “9-5” or “6pm to 11pm”.' };
    let end = e.minutes;
    // "9-5": a finish before the start, written without am/pm, usually means the afternoon.
    if (!e.meridiem && end <= s.minutes && end + 720 > s.minutes && end < 720) end += 720;
    return { ok: true, draft: { kind: 'shift', workplace, date: date ?? ctx.today, startTime: hhmm(s.minutes), endTime: hhmm(end) } };
  }

  if (kind === 'task') {
    if (!title) return { ok: false, message: 'What’s the task?' };
    return { ok: true, draft: { kind: 'task', title, dueDate: date } };
  }

  if (kind === 'expense' || kind === 'income') {
    const amountCents = Math.round((Number.isFinite(raw.amount) ? raw.amount : 0) * 100);
    if (amountCents <= 0 || amountCents > 100_000_000) return { ok: false, message: 'How much was it? Include the amount, e.g. “$12.50”.' };
    if (kind === 'expense') {
      const category = matchByName(ctx.categories, raw.category) ?? ctx.categories.find((c) => c.name === 'Other') ?? ctx.categories[0];
      if (!category) return { ok: false, message: 'Add an expense category first.' };
      return { ok: true, draft: { kind: 'expense', description: title || category.name, amountCents, category, date: date ?? ctx.today } };
    }
    const workplace = matchByName(ctx.workplaces, title);
    const category: IncomeCategory = workplace ? 'wages' : ((INCOME_CATEGORIES as readonly string[]).includes(raw.category.toLowerCase()) ? (raw.category.toLowerCase() as IncomeCategory) : 'other');
    return { ok: true, draft: { kind: 'income', source: workplace?.name ?? (title || 'Income'), amountCents, category, date: date ?? ctx.today, workplaceId: workplace?.id ?? null } };
  }
  return { ok: false, message: 'I can add shifts, tasks, expenses and income. Try “Shift at Cafe Nero Sat 9-5” or “Spent $12 on lunch”.' };
}

/** Short lines describing the draft, for the confirmation card. */
export function describeDraft(d: QuickAddDraft): { title: string; lines: string[] } {
  const when = (k: DateKey) => formatDateKey(k, { weekday: true });
  const t = (v: string) => {
    const p = parseTime(v);
    return p.ok ? formatTime12(p.value) : v;
  };
  switch (d.kind) {
    case 'shift':
      return { title: 'New shift', lines: [d.workplace.name, `${when(d.date)}, ${t(d.startTime)} – ${t(d.endTime)}`, `Base rate ${formatCents(d.workplace.defaultRateCents)}/hr`] };
    case 'task':
      return { title: 'New task', lines: [d.title, d.dueDate ? `Due ${when(d.dueDate)}` : 'No due date'] };
    case 'expense':
      return { title: 'New expense', lines: [`${formatCents(d.amountCents)} · ${d.description}`, `${d.category.name} · ${when(d.date)}`] };
    case 'income':
      return { title: 'New income', lines: [`${formatCents(d.amountCents)} · ${d.source}`, `${d.category[0]!.toUpperCase()}${d.category.slice(1)} · ${when(d.date)}`] };
  }
}

/** Saves a confirmed draft with the same repository code (and validation) as the forms. */
export async function saveDraft(db: SqlDb, d: QuickAddDraft): Promise<void> {
  switch (d.kind) {
    case 'shift':
      await createShift(db, { workplaceId: d.workplace.id, date: d.date, startTime: d.startTime, endTime: d.endTime, unpaidBreakMinutes: 0, hourlyRateCents: d.workplace.defaultRateCents });
      return;
    case 'task':
      await createTask(db, { title: d.title, priority: 2, category: 'personal', dueDate: d.dueDate, recurrence: 'none' });
      return;
    case 'expense':
      await createExpense(db, { categoryId: d.category.id, amountCents: d.amountCents, spentDate: d.date, description: d.description });
      return;
    case 'income':
      await createIncome(db, { amountCents: d.amountCents, payDate: d.date, category: d.category, source: d.source, workplaceId: d.workplaceId });
  }
}

export function quickAddInstructions(today: DateKey, categories: ExpenseCategory[], workplaces: Workplace[]): string {
  return `You turn one short sentence into a record for the MyOrbit app. Today is ${formatDateKey(today, { weekday: true })}.
Workplaces: ${workplaces.map((w) => w.name).join(', ') || 'none yet'}.
Expense categories: ${categories.map((c) => c.name).join(', ')}.
Copy dates exactly as written; don't convert them. Use 24-hour HH:mm for times. If something isn't mentioned, leave it empty.`;
}
