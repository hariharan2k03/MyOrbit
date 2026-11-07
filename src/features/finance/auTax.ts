import type { Cents } from '@/utils/money';

/**
 * Australian income tax estimate for the 2026–27 income year (1 July 2026 –
 * 30 June 2027). Source: ATO tax rates for Australian residents, foreign
 * residents and working holiday makers; 15% second bracket from the More Cost
 * of Living Relief Act 2025. Estimates only — not ATO PAYG withholding tables.
 */
export const TAX_YEAR_LABEL = '2026–27';

export type TaxResidency = 'resident' | 'resident_no_threshold' | 'working_holiday' | 'foreign';

export const TAX_RESIDENCY_LABEL: Record<TaxResidency, string> = {
  resident: 'Resident (tax-free threshold)',
  resident_no_threshold: 'Resident, no tax-free threshold (second job)',
  working_holiday: 'Working holiday maker',
  foreign: 'Foreign resident',
};

/** [threshold in whole dollars above which `rate` applies]. */
type Bracket = readonly [number, number];

const BRACKETS: Record<TaxResidency, readonly Bracket[]> = {
  resident: [
    [18_200, 0.15],
    [45_000, 0.3],
    [135_000, 0.37],
    [190_000, 0.45],
  ],
  // Withheld as if the 15% rate starts at $0 (no tax-free threshold claimed).
  resident_no_threshold: [
    [0, 0.15],
    [45_000, 0.3],
    [135_000, 0.37],
    [190_000, 0.45],
  ],
  working_holiday: [
    [0, 0.15],
    [45_000, 0.3],
    [135_000, 0.37],
    [190_000, 0.45],
  ],
  foreign: [
    [0, 0.3],
    [135_000, 0.37],
    [190_000, 0.45],
  ],
};

/** Medicare levy: 2%, phased in at 10c per $ above the low-income threshold (singles). */
const MEDICARE_RATE = 0.02;
const MEDICARE_LOW_INCOME_THRESHOLD = 27_222;

function bracketTax(dollars: number, brackets: readonly Bracket[]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [from, rate] = brackets[i]!;
    const to = brackets[i + 1]?.[0] ?? Infinity;
    if (dollars > from) tax += (Math.min(dollars, to) - from) * rate;
  }
  return tax;
}

/** Low income tax offset: $700, reduced 5c/$ from $37,500 and 1.5c/$ from $45,000. */
function lowIncomeOffset(dollars: number): number {
  if (dollars <= 37_500) return 700;
  if (dollars <= 45_000) return 700 - (dollars - 37_500) * 0.05;
  return Math.max(0, 325 - (dollars - 45_000) * 0.015);
}

function medicareLevy(dollars: number): number {
  if (dollars <= MEDICARE_LOW_INCOME_THRESHOLD) return 0;
  return Math.min(dollars * MEDICARE_RATE, (dollars - MEDICARE_LOW_INCOME_THRESHOLD) * 0.1);
}

export interface AnnualTax {
  incomeTaxCents: Cents;
  medicareCents: Cents;
  totalCents: Cents;
}

export function annualTax(incomeCents: Cents, residency: TaxResidency): AnnualTax {
  const dollars = Math.max(0, incomeCents) / 100;
  let income = bracketTax(dollars, BRACKETS[residency]);
  if (residency === 'resident') income = Math.max(0, income - lowIncomeOffset(dollars));
  const medicare = residency === 'resident' || residency === 'resident_no_threshold' ? medicareLevy(dollars) : 0;
  const incomeTaxCents = Math.round(income * 100);
  const medicareCents = Math.round(medicare * 100);
  return { incomeTaxCents, medicareCents, totalCents: incomeTaxCents + medicareCents };
}

export interface TakeHome {
  grossCents: Cents;
  taxCents: Cents;
  netCents: Cents;
}

/**
 * Estimated tax on one pay period by annualising it: a week's gross × 52,
 * taxed for the year, then ÷ 52. This is how withholding works in spirit and
 * is a fair guide for regular pay; irregular pay will differ at tax time.
 */
export function takeHome(periodGrossCents: Cents, periodsPerYear: number, residency: TaxResidency): TakeHome {
  if (periodGrossCents <= 0) return { grossCents: 0, taxCents: 0, netCents: 0 };
  const annual = annualTax(periodGrossCents * periodsPerYear, residency);
  const taxCents = Math.round(annual.totalCents / periodsPerYear);
  return { grossCents: periodGrossCents, taxCents, netCents: periodGrossCents - taxCents };
}
