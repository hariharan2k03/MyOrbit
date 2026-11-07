import { assertCents, type Cents } from '@/utils/money';
import { unwrap, ValidationError } from '@/utils/result';
import { isValidDateKey, type DateKey, type DateRange } from '@/utils/time';
import { cleanText, LIMITS } from '@/utils/validation';
import type { SqlDb, SqlValue } from '../types';

export interface ExpenseCategory {
  id: number;
  name: string;
  icon: string;
  color: string;
}

export interface Expense {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  amountCents: Cents;
  spentDate: DateKey;
  description: string;
  notes: string | null;
}

export const INCOME_CATEGORIES = ['wages', 'salary', 'freelance', 'scholarship', 'gift', 'refund', 'other'] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export interface Income {
  id: number;
  amountCents: Cents;
  payDate: DateKey;
  category: IncomeCategory;
  source: string;
  workplaceId: number | null;
  notes: string | null;
}

export interface Budget {
  id: number;
  categoryId: number | null;
  limitCents: Cents;
  periodStartDay: number;
}

function requireDate(key: string, label: string) {
  if (!isValidDateKey(key)) throw new ValidationError(`${label} is not a valid date.`);
}

function requireAmount(cents: number) {
  assertCents(cents);
  if (cents === 0) throw new ValidationError('Amount must be greater than zero.');
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function listCategories(db: SqlDb): Promise<ExpenseCategory[]> {
  return db.getAllAsync<ExpenseCategory>('SELECT id, name, icon, color FROM expense_categories ORDER BY sort_order, name');
}

// ── Expenses ────────────────────────────────────────────────────────────────

export interface ExpenseInput {
  categoryId: number;
  amountCents: Cents;
  spentDate: DateKey;
  description: string;
  notes?: string | null;
}

function cleanExpense(input: ExpenseInput) {
  requireAmount(input.amountCents);
  requireDate(input.spentDate, 'Date');
  return {
    description: unwrap(cleanText(input.description, 'Description', LIMITS.title, { required: true })),
    notes: unwrap(cleanText(input.notes, 'Notes', LIMITS.notes)) || null,
  };
}

/**
 * Duplicate guard: an identical expense (same amount, category, date and
 * description) entered within 2 minutes is almost always a double-tap.
 */
const DUPLICATE_WINDOW_MS = 2 * 60_000;

export async function createExpense(db: SqlDb, input: ExpenseInput): Promise<number> {
  const e = cleanExpense(input);
  const now = Date.now();
  const dup = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM expenses WHERE category_id = ? AND amount_cents = ? AND spent_date = ?
       AND description = ? AND created_at > ?`,
    [input.categoryId, input.amountCents, input.spentDate, e.description, now - DUPLICATE_WINDOW_MS],
  );
  if (dup) throw new ValidationError('This looks like a duplicate of an expense you just added.');
  const r = await db.runAsync(
    `INSERT INTO expenses (category_id, amount_cents, spent_date, description, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.categoryId, input.amountCents, input.spentDate, e.description, e.notes, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateExpense(db: SqlDb, id: number, input: ExpenseInput): Promise<void> {
  const e = cleanExpense(input);
  await db.runAsync(
    `UPDATE expenses SET category_id = ?, amount_cents = ?, spent_date = ?, description = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [input.categoryId, input.amountCents, input.spentDate, e.description, e.notes, Date.now(), id],
  );
}

export async function deleteExpense(db: SqlDb, id: number): Promise<void> {
  await db.runAsync('DELETE FROM expenses WHERE id = ?', [id]);
}

export interface ExpenseFilter {
  id?: number;
  range?: DateRange;
  categoryId?: number | null;
  search?: string;
  limit?: number;
}

/** Search uses a bound LIKE parameter with escaped wildcards — never string-built SQL. */
export async function listExpenses(db: SqlDb, filter: ExpenseFilter = {}): Promise<Expense[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filter.id !== undefined) {
    where.push('e.id = ?');
    params.push(filter.id);
  }
  if (filter.range) {
    where.push('e.spent_date >= ? AND e.spent_date < ?');
    params.push(filter.range.start, filter.range.end);
  }
  if (filter.categoryId) {
    where.push('e.category_id = ?');
    params.push(filter.categoryId);
  }
  const search = (filter.search ?? '').trim().slice(0, LIMITS.title);
  if (search) {
    where.push(`(e.description LIKE ? ESCAPE '\\' OR e.notes LIKE ? ESCAPE '\\')`);
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  params.push(Math.min(filter.limit ?? 200, 1000));
  const rows = await db.getAllAsync<{
    id: number;
    category_id: number;
    category_name: string;
    category_color: string;
    category_icon: string;
    amount_cents: number;
    spent_date: string;
    description: string;
    notes: string | null;
  }>(
    `SELECT e.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY e.spent_date DESC, e.id DESC LIMIT ?`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    categoryName: r.category_name,
    categoryColor: r.category_color,
    categoryIcon: r.category_icon,
    amountCents: r.amount_cents,
    spentDate: r.spent_date,
    description: r.description,
    notes: r.notes,
  }));
}

export interface CategoryTotal {
  categoryId: number;
  name: string;
  color: string;
  totalCents: Cents;
}

export async function expenseTotalsByCategory(db: SqlDb, range: DateRange): Promise<CategoryTotal[]> {
  const rows = await db.getAllAsync<{ category_id: number; name: string; color: string; total: number }>(
    `SELECT c.id AS category_id, c.name, c.color, COALESCE(SUM(e.amount_cents), 0) AS total
     FROM expense_categories c
     LEFT JOIN expenses e ON e.category_id = c.id AND e.spent_date >= ? AND e.spent_date < ?
     GROUP BY c.id ORDER BY total DESC, c.sort_order`,
    [range.start, range.end],
  );
  return rows.map((r) => ({ categoryId: r.category_id, name: r.name, color: r.color, totalCents: r.total }));
}

export async function totalExpenses(db: SqlDb, range: DateRange): Promise<Cents> {
  const r = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses WHERE spent_date >= ? AND spent_date < ?',
    [range.start, range.end],
  );
  return r?.total ?? 0;
}

/** Spending per day in a range, for charts (days with no spending are omitted). */
export async function dailyExpenseTotals(db: SqlDb, range: DateRange): Promise<Map<DateKey, Cents>> {
  const rows = await db.getAllAsync<{ d: string; total: number }>(
    `SELECT spent_date AS d, SUM(amount_cents) AS total FROM expenses
     WHERE spent_date >= ? AND spent_date < ? GROUP BY spent_date`,
    [range.start, range.end],
  );
  return new Map(rows.map((r) => [r.d, r.total]));
}

// ── Income ──────────────────────────────────────────────────────────────────

export interface IncomeInput {
  amountCents: Cents;
  payDate: DateKey;
  category: IncomeCategory;
  source: string;
  workplaceId?: number | null;
  notes?: string | null;
}

function cleanIncome(input: IncomeInput) {
  requireAmount(input.amountCents);
  requireDate(input.payDate, 'Pay date');
  if (!INCOME_CATEGORIES.includes(input.category)) throw new ValidationError('Choose an income category.');
  return {
    source: unwrap(cleanText(input.source, 'Source', LIMITS.title, { required: true })),
    notes: unwrap(cleanText(input.notes, 'Notes', LIMITS.notes)) || null,
  };
}

export async function createIncome(db: SqlDb, input: IncomeInput): Promise<number> {
  const i = cleanIncome(input);
  const now = Date.now();
  const r = await db.runAsync(
    `INSERT INTO income (amount_cents, pay_date, category, source, workplace_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.amountCents, input.payDate, input.category, i.source, input.workplaceId ?? null, i.notes, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateIncome(db: SqlDb, id: number, input: IncomeInput): Promise<void> {
  const i = cleanIncome(input);
  await db.runAsync(
    `UPDATE income SET amount_cents = ?, pay_date = ?, category = ?, source = ?, workplace_id = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [input.amountCents, input.payDate, input.category, i.source, input.workplaceId ?? null, i.notes, Date.now(), id],
  );
}

export async function deleteIncome(db: SqlDb, id: number): Promise<void> {
  await db.runAsync('DELETE FROM income WHERE id = ?', [id]);
}

export async function listIncome(db: SqlDb, range: DateRange): Promise<Income[]> {
  const rows = await db.getAllAsync<{
    id: number;
    amount_cents: number;
    pay_date: string;
    category: IncomeCategory;
    source: string;
    workplace_id: number | null;
    notes: string | null;
  }>('SELECT * FROM income WHERE pay_date >= ? AND pay_date < ? ORDER BY pay_date DESC, id DESC', [range.start, range.end]);
  return rows.map((r) => ({
    id: r.id,
    amountCents: r.amount_cents,
    payDate: r.pay_date,
    category: r.category,
    source: r.source,
    workplaceId: r.workplace_id,
    notes: r.notes,
  }));
}

export async function totalIncome(db: SqlDb, range: DateRange): Promise<Cents> {
  const r = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM income WHERE pay_date >= ? AND pay_date < ?',
    [range.start, range.end],
  );
  return r?.total ?? 0;
}

// ── Budgets ─────────────────────────────────────────────────────────────────

export async function listBudgets(db: SqlDb): Promise<Budget[]> {
  const rows = await db.getAllAsync<{ id: number; category_id: number | null; limit_cents: number; period_start_day: number }>(
    'SELECT * FROM budgets ORDER BY category_id IS NOT NULL, category_id',
  );
  return rows.map((r) => ({ id: r.id, categoryId: r.category_id, limitCents: r.limit_cents, periodStartDay: r.period_start_day }));
}

/** Creates or replaces the budget for a category (null = overall). Only ever called by explicit user action. */
export async function setBudget(db: SqlDb, categoryId: number | null, limitCents: Cents, periodStartDay = 1): Promise<void> {
  requireAmount(limitCents);
  if (!Number.isInteger(periodStartDay) || periodStartDay < 1 || periodStartDay > 28) {
    throw new ValidationError('Budget start day must be between 1 and 28.');
  }
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: number }>(
      categoryId === null ? 'SELECT id FROM budgets WHERE category_id IS NULL' : 'SELECT id FROM budgets WHERE category_id = ?',
      categoryId === null ? [] : [categoryId],
    );
    if (existing) {
      await db.runAsync('UPDATE budgets SET limit_cents = ?, period_start_day = ?, updated_at = ? WHERE id = ?', [
        limitCents,
        periodStartDay,
        now,
        existing.id,
      ]);
    } else {
      await db.runAsync(
        'INSERT INTO budgets (category_id, limit_cents, period_start_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [categoryId, limitCents, periodStartDay, now, now],
      );
    }
  });
}

export async function deleteBudget(db: SqlDb, id: number): Promise<void> {
  await db.runAsync('DELETE FROM budgets WHERE id = ?', [id]);
}

export async function getExpense(db: SqlDb, id: number): Promise<Expense | null> {
  const [e] = await listExpenses(db, { id, limit: 1 });
  return e ?? null;
}

export async function getIncome(db: SqlDb, id: number): Promise<Income | null> {
  const r = await db.getFirstAsync<{
    id: number;
    amount_cents: number;
    pay_date: string;
    category: IncomeCategory;
    source: string;
    workplace_id: number | null;
    notes: string | null;
  }>('SELECT * FROM income WHERE id = ?', [id]);
  if (!r) return null;
  return {
    id: r.id,
    amountCents: r.amount_cents,
    payDate: r.pay_date,
    category: r.category,
    source: r.source,
    workplaceId: r.workplace_id,
    notes: r.notes,
  };
}
