import { ratioBp, type Cents } from '@/utils/money';

export type BudgetLevel = 'ok' | 'warning' | 'over';

export interface BudgetStatus {
  limitCents: Cents;
  spentCents: Cents;
  /** Negative when overspent. */
  remainingCents: Cents;
  /** Spent as basis points of the limit (10000 = 100%). */
  usedBp: number;
  level: BudgetLevel;
}

/** Warn at 80% by default. Never mutates or auto-adjusts the budget itself. */
export function budgetStatus(limitCents: Cents, spentCents: Cents, warnAtBp = 8_000): BudgetStatus {
  const usedBp = ratioBp(spentCents, limitCents);
  const level: BudgetLevel = spentCents > limitCents ? 'over' : usedBp >= warnAtBp ? 'warning' : 'ok';
  return { limitCents, spentCents, remainingCents: limitCents - spentCents, usedBp, level };
}

export interface PeriodTotals {
  incomeCents: Cents;
  expenseCents: Cents;
}

/** Net savings for a period (income − expenses). Negative means a shortfall. */
export function savingsFor({ incomeCents, expenseCents }: PeriodTotals): Cents {
  return incomeCents - expenseCents;
}

export interface Comparison {
  deltaCents: Cents;
  /** Change vs previous in bp; null when there is no previous spending to compare to. */
  changeBp: number | null;
}

export function compareToPrevious(current: Cents, previous: Cents): Comparison {
  const deltaCents = current - previous;
  if (previous <= 0) return { deltaCents, changeBp: null };
  const sign = deltaCents < 0 ? -1 : 1;
  return { deltaCents, changeBp: sign * ratioBp(Math.abs(deltaCents), previous) };
}
