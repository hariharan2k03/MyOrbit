import { annualTax, takeHome } from '@/features/finance/auTax';
import { baseOnly, shiftPay, type PayRates } from '@/features/work/payRates';
import { fortnightRange } from '@/utils/time';

// TZ=Australia/Melbourne (see package.json).
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const rates: PayRates = {
  baseCents: 3000,
  saturdayCents: 3750, // 125%
  sundayCents: 4500, // 150%
  nightCents: 3600, // 120%
  nightStartMin: 19 * 60,
  nightEndMin: 7 * 60,
};

describe('penalty rates', () => {
  it('pays a plain weekday shift at base', () => {
    // Tue 10 Nov 2026, 9–5 with 30 min break → 7.5h × $30
    const p = shiftPay({ startAt: at(2026, 11, 10, 9), endAt: at(2026, 11, 10, 17), unpaidBreakMinutes: 30 }, rates);
    expect(p).toMatchObject({ paidMinutes: 450, grossCents: 22500 });
    expect(p.segments.map((s) => s.kind)).toEqual(['base']);
  });

  it('switches to the night rate inside the night window', () => {
    // Tue 5 PM – 11 PM, no break: 2h base + 4h night
    const p = shiftPay({ startAt: at(2026, 11, 10, 17), endAt: at(2026, 11, 10, 23), unpaidBreakMinutes: 0 }, rates);
    expect(p.segments).toEqual([
      { kind: 'base', rateCents: 3000, minutes: 120, cents: 6000 },
      { kind: 'night', rateCents: 3600, minutes: 240, cents: 14400 },
    ]);
    expect(p.grossCents).toBe(20400);
  });

  it('moves from Saturday to Sunday rates at midnight on an overnight shift', () => {
    // Sat 14 Nov 10 PM – Sun 2 AM: 2h Saturday (beats night) + 2h Sunday
    const p = shiftPay({ startAt: at(2026, 11, 14, 22), endAt: at(2026, 11, 15, 2), unpaidBreakMinutes: 0 }, rates);
    expect(p.segments.map((s) => [s.kind, s.minutes])).toEqual([
      ['saturday', 120],
      ['sunday', 120],
    ]);
    expect(p.grossCents).toBe(7500 + 9000);
  });

  it('takes the unpaid break from the middle of the shift', () => {
    // Tue 3 PM – 11 PM with 60 min break centred at 7 PM: 3.5h base, 3.5h night
    const p = shiftPay({ startAt: at(2026, 11, 10, 15), endAt: at(2026, 11, 10, 23), unpaidBreakMinutes: 60 }, rates);
    expect(p.paidMinutes).toBe(420);
    expect(p.segments.map((s) => [s.kind, s.minutes])).toEqual([
      ['base', 210],
      ['night', 210],
    ]);
  });

  it('pays the real hours across a DST change', () => {
    // Sat 4 Apr 2026 10 PM – Sun 6 AM: clocks go back, 9 real hours
    const p = shiftPay({ startAt: at(2026, 4, 4, 22), endAt: at(2026, 4, 5, 6), unpaidBreakMinutes: 0 }, baseOnly(3000));
    expect(p).toMatchObject({ paidMinutes: 540, grossCents: 27000 });
  });

  it('uses base only when no penalties are set', () => {
    const p = shiftPay({ startAt: at(2026, 11, 15, 9), endAt: at(2026, 11, 15, 10), unpaidBreakMinutes: 0 }, baseOnly(2913));
    expect(p.grossCents).toBe(2913);
  });
});

describe('Australian tax 2026–27', () => {
  it('applies the resident brackets, LITO and Medicare levy', () => {
    expect(annualTax(1_820_000, 'resident').totalCents).toBe(0);
    // $45,000: 15% × 26,800 = 4,020 − LITO 325 = 3,695; Medicare 2% = 900
    expect(annualTax(4_500_000, 'resident')).toEqual({ incomeTaxCents: 369_500, medicareCents: 90_000, totalCents: 459_500 });
    // $30,000: 15% × 11,800 = 1,770 − 700 = 1,070; Medicare phase-in 10% × 2,778 = 277.80
    expect(annualTax(3_000_000, 'resident')).toEqual({ incomeTaxCents: 107_000, medicareCents: 27_780, totalCents: 134_780 });
    // $100,000: 4,020 + 30% × 55,000 = 20,520; Medicare 2,000
    expect(annualTax(10_000_000, 'resident').totalCents).toBe(2_252_000);
  });

  it('handles other residency types', () => {
    expect(annualTax(2_000_000, 'working_holiday')).toEqual({ incomeTaxCents: 300_000, medicareCents: 0, totalCents: 300_000 });
    expect(annualTax(2_000_000, 'foreign').incomeTaxCents).toBe(600_000);
    expect(annualTax(2_000_000, 'resident_no_threshold').incomeTaxCents).toBe(300_000);
  });

  it('estimates weekly take-home by annualising', () => {
    // $600/week = $31,200/yr resident: tax 1,950 − 700 = 1,250; Medicare 10% × 3,978 = 397.80 → 1,647.80/52 ≈ $31.69
    expect(takeHome(60_000, 52, 'resident')).toEqual({ grossCents: 60_000, taxCents: 3169, netCents: 56_831 });
    expect(takeHome(0, 52, 'resident').netCents).toBe(0);
  });
});

describe('fortnightly pay periods', () => {
  it('groups two Monday-to-Sunday weeks, aligned to the pay anchor', () => {
    // Anchor Mon 5 Jan 2026 starts a fortnight, so 2 Nov 2026 (43 weeks later, odd) is a second week.
    expect(fortnightRange('2026-11-07', '2026-01-05')).toEqual({ start: '2026-10-26', end: '2026-11-09' });
    expect(fortnightRange('2026-11-09', '2026-01-05')).toEqual({ start: '2026-11-09', end: '2026-11-23' });
    expect(fortnightRange('2026-11-22', '2026-01-05')).toEqual({ start: '2026-11-09', end: '2026-11-23' });
  });

  it('moves by one week when the anchor is shifted, and accepts any day of the anchor week', () => {
    expect(fortnightRange('2026-11-07', '2026-01-12')).toEqual({ start: '2026-11-02', end: '2026-11-16' });
    expect(fortnightRange('2026-11-07', '2026-01-08')).toEqual(fortnightRange('2026-11-07', '2026-01-05'));
    // Anchors after the date work too.
    expect(fortnightRange('2026-11-07', '2027-03-01')).toEqual(fortnightRange('2026-11-07', '2026-01-05'));
  });
});
