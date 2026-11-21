import { listCategories, listPendingPurchases, updateExpense } from '@/database/repositories/finance';
import { categorizeMerchant, guessCategoryName, normalizeMerchant } from '@/features/finance/merchantCategory';
import { applyIntentActions, completePendingPurchase, parseIntentAction } from '@/features/intents/intentActions';
import { createTestDb } from './helpers/testDb';

describe('store names → categories', () => {
  it.each([
    ['WOOLWORTHS 1234 CLAYTON', 'Groceries'],
    ['Coles Express', 'Groceries'],
    ['ALDI STORES', 'Groceries'],
    ["McDonald's Clayton", 'Eating Out'],
    ['UBER *EATS', 'Eating Out'],
    ['Uber *Trip', 'Transport'],
    ['NANDOS CHADSTONE', 'Eating Out'],
    ['Subway Monash', 'Eating Out'],
    ['BP Clayton North', 'Transport'],
    ['PTV MYKI TOP UP', 'Transport'],
    ['NETFLIX.COM', 'Entertainment'],
    ['Telstra Prepaid', 'Internet'],
    ['KMART 1063', 'Shopping'],
    ['JB HI-FI', 'Shopping'],
    ['Monash University', 'Education'],
  ])('%s → %s', (merchant, category) => {
    expect(guessCategoryName(merchant)).toBe(category);
  });

  it('does not match words inside other words', () => {
    expect(guessCategoryName('BIGA PIZZERIA')).toBeNull(); // "iga" inside "biga", "pizza" inside "pizzeria"
    expect(guessCategoryName('Random Merchant')).toBeNull();
    expect(normalizeMerchant('WOOLWORTHS 1234 CLAYTON PTY LTD')).toBe('woolworths clayton');
  });

  it('learns from a category you chose before', () => {
    const cats = [
      { id: 1, name: 'Groceries' },
      { id: 2, name: 'Eating Out' },
      { id: 9, name: 'Other' },
    ];
    expect(categorizeMerchant('Random Merchant', cats, [])).toBe(9);
    expect(categorizeMerchant('RANDOM MERCHANT 22', cats, [{ description: 'Random Merchant', categoryId: 2 }])).toBe(2);
    // Your choice beats the built-in rules.
    expect(categorizeMerchant('Coles Express', cats, [{ description: 'COLES EXPRESS', categoryId: 2 }])).toBe(2);
  });
});

describe('Apple Pay purchases', () => {
  it('rejects malformed queue entries', () => {
    expect(parseIntentAction(JSON.stringify({ type: 'logPurchase', amountCents: 0, merchant: 'x', date: '2026-11-11' }))).toBeNull();
    expect(parseIntentAction(JSON.stringify({ type: 'logPurchase', amountCents: 450, merchant: 'x', date: 'nope' }))).toBeNull();
    expect(parseIntentAction(JSON.stringify({ type: 'logPurchase', amountCents: 450, merchant: '  ', card: 'Visa', date: '2026-11-11' }))).toEqual({
      type: 'logPurchase',
      amountCents: 450,
      merchant: 'Apple Pay',
      card: 'Visa',
      date: '2026-11-11',
    });
  });

  it('saves each purchase, keeps genuine repeats, and learns your corrections', async () => {
    const db = await createTestDb();
    const cats = await listCategories(db);
    const id = (name: string) => cats.find((c) => c.name === name)!.id;
    expect(cats.some((c) => c.name === 'Eating Out')).toBe(true);

    const coffee = { type: 'logPurchase' as const, amountCents: 550, merchant: 'Seven Seeds', card: 'CommBank Debit', date: '2026-11-11' };
    const r = await applyIntentActions(db, [coffee, coffee, { ...coffee, merchant: 'WOOLWORTHS 1234', amountCents: 4210 }], '2026-11-11');
    expect(r).toMatchObject({ purchases: 3, added: [] });

    const rows = await db.getAllAsync<{ id: number; description: string; category_id: number; notes: string; amount_cents: number }>('SELECT * FROM expenses ORDER BY id');
    expect(rows.map((x) => [x.description, x.amount_cents, x.category_id])).toEqual([
      ['Seven Seeds', 550, id('Other')],
      ['Seven Seeds', 550, id('Other')],
      ['WOOLWORTHS 1234', 4210, id('Groceries')],
    ]);
    expect(rows[0]!.notes).toBe('Apple Pay · CommBank Debit');

    // Move one Seven Seeds purchase to Eating Out; the next one follows.
    await updateExpense(db, rows[1]!.id, { categoryId: id('Eating Out'), amountCents: 550, spentDate: '2026-11-11', description: 'Seven Seeds', notes: 'Apple Pay' });
    await applyIntentActions(db, [{ ...coffee, merchant: 'SEVEN SEEDS' }], '2026-11-11');
    const last = await db.getFirstAsync<{ category_id: number }>('SELECT category_id FROM expenses ORDER BY id DESC LIMIT 1');
    expect(last?.category_id).toBe(id('Eating Out'));
  });
});

describe('Apple Pay purchases without an amount', () => {
  it('keeps them until you type the amount, then saves with a category', async () => {
    const db = await createTestDb();
    const parsed = parseIntentAction(JSON.stringify({ type: 'pendingPurchase', merchant: 'WOOLWORTHS 1234', card: 'Debit', date: '2026-11-13' }));
    expect(parsed).toEqual({ type: 'pendingPurchase', merchant: 'WOOLWORTHS 1234', card: 'Debit', date: '2026-11-13' });

    const r = await applyIntentActions(db, [parsed!], '2026-11-13');
    expect(r).toMatchObject({ pending: 1, purchases: 0 });
    const [p] = await listPendingPurchases(db);
    expect(p).toMatchObject({ merchant: 'WOOLWORTHS 1234', card: 'Debit', spentDate: '2026-11-13' });

    await completePendingPurchase(db, p!, 3125);
    expect(await listPendingPurchases(db)).toEqual([]);
    const e = await db.getFirstAsync<{ description: string; amount_cents: number; spent_date: string; name: string; notes: string }>(
      'SELECT e.description, e.amount_cents, e.spent_date, c.name, e.notes FROM expenses e JOIN expense_categories c ON c.id = e.category_id',
    );
    expect(e).toEqual({ description: 'WOOLWORTHS 1234', amount_cents: 3125, spent_date: '2026-11-13', name: 'Groceries', notes: 'Apple Pay · Debit' });
  });
});
