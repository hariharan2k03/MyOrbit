import { err, ok, type Result } from './result';

/**
 * All money is held as integer cents (AUD). Floats never touch arithmetic:
 * user input is parsed as a string, and rates × minutes are integer products.
 */
export type Cents = number;

/** $10,000,000.00 — far above any personal transaction, keeps us well inside 2^53. */
export const MAX_CENTS = 1_000_000_000;

const MONEY_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

export function parseMoneyToCents(input: string, opts: { allowZero?: boolean } = {}): Result<Cents> {
  const cleaned = input.trim().replace(/^A?\$/, '').replace(/,/g, '').trim();
  if (cleaned === '') return err('Enter an amount.');
  if (cleaned.startsWith('-')) return err('Amount cannot be negative.');
  const m = MONEY_RE.exec(cleaned);
  if (!m) return err('Enter a valid amount with up to 2 decimal places.');
  const whole = m[1]!;
  if (whole.length > 8) return err('Amount is too large.');
  const cents = Number(whole) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (cents > MAX_CENTS) return err('Amount is too large.');
  if (cents === 0 && !opts.allowZero) return err('Amount must be greater than zero.');
  return ok(cents);
}

export function assertCents(value: number, label = 'Amount'): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CENTS) {
    throw new Error(`${label} must be a whole number of cents between 0 and ${MAX_CENTS}.`);
  }
}

/** Formats cents as AUD, e.g. 123456 → "$1,234.56". Deterministic (no locale lookup). */
export function formatCents(cents: Cents, opts: { showCents?: boolean; masked?: boolean } = {}): string {
  if (opts.masked) return '$•••';
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const showCents = opts.showCents ?? true;
  const body = showCents ? `${dollars}.${String(abs % 100).padStart(2, '0')}` : dollars;
  return `${negative ? '-' : ''}$${body}`;
}

/** Cents → editable string ("1234.5" → "1234.50"). */
export function centsToInput(cents: Cents): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Integer-only percentage in basis points (1% = 100 bp), rounded half up. */
export function ratioBp(part: Cents, whole: Cents): number {
  if (whole <= 0) return 0;
  return Math.floor((part * 10_000 + Math.floor(whole / 2)) / whole);
}
