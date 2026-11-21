import { getActiveActivitySession, startActivitySession } from '@/database/repositories/activities';
import { addPendingPurchase, createExpense, dismissPendingPurchase, listCategories, type PendingPurchase } from '@/database/repositories/finance';
import { completeTask, createTask } from '@/database/repositories/tasks';
import type { SqlDb } from '@/database/types';
import { categorizeMerchant } from '@/features/finance/merchantCategory';
import { formatCents } from '@/utils/money';
import { isValidDateKey, type DateKey } from '@/utils/time';

/** Actions queued by Siri / Shortcuts (plugins/app-intents/MyOrbitIntents.swift) or widget buttons. */
export type IntentAction =
  | { type: 'startTimer'; kind: 'focus' | 'break'; minutes: number }
  | { type: 'addExpense'; amountCents: number; description: string; date: DateKey }
  | { type: 'addTask'; title: string; date: DateKey }
  /** From a Wallet transaction automation: an Apple Pay purchase. */
  | { type: 'logPurchase'; amountCents: number; merchant: string; card: string; date: DateKey }
  /** An Apple Pay purchase Wallet sent without an amount; kept until you add it. */
  | { type: 'pendingPurchase'; merchant: string; card: string; date: DateKey }
  | { type: 'completeTask'; taskId: number };

/** Validates one queued JSON action. Anything malformed is dropped, never applied. */
export function parseIntentAction(json: string): IntentAction | null {
  let a: Record<string, unknown>;
  try {
    a = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof a !== 'object' || a === null) return null;
  const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  const date = (v: unknown) => (typeof v === 'string' && isValidDateKey(v) ? v : null);
  switch (a.type) {
    case 'startTimer': {
      const minutes = int(a.minutes, 5, 180);
      if (minutes === null || (a.kind !== 'focus' && a.kind !== 'break')) return null;
      return { type: 'startTimer', kind: a.kind, minutes };
    }
    case 'addExpense': {
      const amountCents = int(a.amountCents, 1, 10_000_000);
      const d = date(a.date);
      if (amountCents === null || !d) return null;
      return { type: 'addExpense', amountCents, description: text(a.description) ?? 'Expense', date: d };
    }
    case 'logPurchase': {
      const amountCents = int(a.amountCents, 1, 10_000_000);
      const d = date(a.date);
      if (amountCents === null || !d) return null;
      const card = typeof a.card === 'string' ? a.card.trim().slice(0, 60) : '';
      return { type: 'logPurchase', amountCents, merchant: text(a.merchant) ?? 'Apple Pay', card, date: d };
    }
    case 'pendingPurchase': {
      const d = date(a.date);
      if (!d) return null;
      const card = typeof a.card === 'string' ? a.card.trim().slice(0, 60) : '';
      return { type: 'pendingPurchase', merchant: text(a.merchant) ?? 'Apple Pay', card, date: d };
    }
    case 'addTask': {
      const title = text(a.title);
      const d = date(a.date);
      if (!title || !d) return null;
      return { type: 'addTask', title, date: d };
    }
    case 'completeTask': {
      const taskId = int(a.taskId, 1, Number.MAX_SAFE_INTEGER);
      return taskId === null ? null : { type: 'completeTask', taskId };
    }
    default:
      return null;
  }
}

export interface ApplyResult {
  /** Short lines for the "Added from Siri" message. */
  added: string[];
  /** Set when a timer should be shown. */
  openTimer: boolean;
  /** Set when a timer was asked for but one is already running. */
  timerBusy: boolean;
  /** Apple Pay purchases saved (added quietly, without an alert). */
  purchases: number;
  /** Apple Pay purchases that need an amount typed in. */
  pending: number;
}

/**
 * Applies queued actions with the same repository code (and validation) as
 * the app's own forms. One failing action doesn't stop the others.
 */
export async function applyIntentActions(db: SqlDb, actions: IntentAction[], today: DateKey, now = Date.now()): Promise<ApplyResult> {
  const result: ApplyResult = { added: [], openTimer: false, timerBusy: false, purchases: 0, pending: 0 };
  for (const a of actions) {
    try {
      switch (a.type) {
        case 'startTimer': {
          // Don't silently cancel a study session or shift someone already started.
          if (await getActiveActivitySession(db, now)) {
            result.timerBusy = true;
            result.openTimer = true;
            break;
          }
          await startActivitySession(
            db,
            {
              kind: a.kind,
              title: a.kind === 'focus' ? 'Focus session' : 'Break',
              subtitle: `${a.minutes} min`,
              startsAt: now,
              endsAt: now + a.minutes * 60_000,
              nextActivity: a.kind === 'break' ? 'Back to focus' : null,
            },
            now,
          );
          result.openTimer = true;
          break;
        }
        case 'addExpense': {
          const categories = await listCategories(db);
          const category = categories.find((c) => c.name === 'Other') ?? categories[0];
          if (!category) break;
          await createExpense(db, { categoryId: category.id, amountCents: a.amountCents, spentDate: a.date, description: a.description });
          result.added.push(`${formatCents(a.amountCents)} · ${a.description}`);
          break;
        }
        case 'logPurchase': {
          const categories = await listCategories(db);
          const history = await db.getAllAsync<{ description: string; categoryId: number }>(
            // Most recently edited first, so moving a purchase to another category teaches the next one.
            'SELECT description, category_id AS categoryId FROM expenses ORDER BY updated_at DESC, id DESC LIMIT 500',
          );
          const categoryId = categorizeMerchant(a.merchant, categories, history);
          if (categoryId === null) break;
          await createExpense(
            db,
            { categoryId, amountCents: a.amountCents, spentDate: a.date, description: a.merchant, notes: a.card ? `Apple Pay · ${a.card}` : 'Apple Pay' },
            { allowRepeat: true },
          );
          result.purchases++;
          break;
        }
        case 'pendingPurchase':
          await addPendingPurchase(db, a.merchant, a.card, a.date);
          result.pending++;
          break;
        case 'addTask':
          await createTask(db, { title: a.title, priority: 2, category: 'personal', dueDate: a.date, recurrence: 'none' });
          result.added.push(`Task · ${a.title}`);
          break;
        case 'completeTask': {
          const open = await db.getFirstAsync<{ id: number }>('SELECT id FROM tasks WHERE id = ? AND completed_at IS NULL', [a.taskId]);
          if (open) await completeTask(db, a.taskId, today, now);
          break;
        }
      }
    } catch (e) {
      console.warn('Queued action failed', a.type, e);
    }
  }
  return result;
}

/** Saves a waiting Apple Pay purchase once you've typed its amount (category picked as usual). */
export async function completePendingPurchase(db: SqlDb, p: PendingPurchase, amountCents: number): Promise<void> {
  const categories = await listCategories(db);
  const history = await db.getAllAsync<{ description: string; categoryId: number }>(
    'SELECT description, category_id AS categoryId FROM expenses ORDER BY updated_at DESC, id DESC LIMIT 500',
  );
  const categoryId = categorizeMerchant(p.merchant, categories, history);
  if (categoryId === null) throw new Error('Add an expense category first.');
  await db.withTransactionAsync(async () => {
    await createExpense(db, { categoryId, amountCents, spentDate: p.spentDate, description: p.merchant, notes: p.card ? `Apple Pay · ${p.card}` : 'Apple Pay' }, { allowRepeat: true });
    await dismissPendingPurchase(db, p.id);
  });
}
