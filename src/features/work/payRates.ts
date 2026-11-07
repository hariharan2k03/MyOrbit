import type { Cents } from '@/utils/money';
import { MINUTE_MS } from '@/utils/time';

/**
 * Penalty rates for a workplace, as absolute hourly amounts in cents (e.g. a
 * $30 base with Saturday at 125% is saturdayCents = 3750). `null` = no penalty.
 * Night window is in minutes after midnight and may wrap midnight (19:00–07:00).
 */
export interface PayRates {
  baseCents: Cents;
  saturdayCents: Cents | null;
  sundayCents: Cents | null;
  nightCents: Cents | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
}

export type PayKind = 'base' | 'night' | 'saturday' | 'sunday';

export interface PaySegment {
  kind: PayKind;
  rateCents: Cents;
  minutes: number;
  cents: Cents;
}

export interface ShiftPay {
  paidMinutes: number;
  grossCents: Cents;
  segments: PaySegment[];
}

export const baseOnly = (baseCents: Cents): PayRates => ({
  baseCents,
  saturdayCents: null,
  sundayCents: null,
  nightCents: null,
  nightStartMin: null,
  nightEndMin: null,
});

function inWindow(minuteOfDay: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
}

/** Order used to break ties between equal rates (weekend beats night beats base). */
const RANK: Record<PayKind, number> = { base: 0, night: 1, saturday: 2, sunday: 3 };

/**
 * Splits a shift into pay segments. Every paid minute is paid at the highest
 * rate that applies to it (Sunday, Saturday or night), so a Saturday-night
 * shift running past midnight moves to the Sunday rate at 12:00 AM.
 *
 * The unpaid break is taken from the middle of the shift — where breaks are
 * normally taken — so it reduces whichever rate applies at that time.
 * Minutes are walked as real instants, so DST changes are paid as worked.
 */
export function shiftPay(shift: { startAt: number; endAt: number; unpaidBreakMinutes: number }, rates: PayRates): ShiftPay {
  const total = Math.max(0, Math.round((shift.endAt - shift.startAt) / MINUTE_MS));
  const brk = Math.min(Math.max(0, shift.unpaidBreakMinutes), total);
  const breakStart = Math.floor((total - brk) / 2);
  const breakEnd = breakStart + brk;

  const buckets = new Map<PayKind, { rate: Cents; minutes: number }>();
  for (let i = 0; i < total; i++) {
    if (i >= breakStart && i < breakEnd) continue;
    const t = new Date(shift.startAt + i * MINUTE_MS);
    const dow = t.getDay();
    const mod = t.getHours() * 60 + t.getMinutes();

    let kind: PayKind = 'base';
    let rate = rates.baseCents;
    const consider = (k: PayKind, r: Cents | null) => {
      if (r === null) return;
      if (r > rate || (r === rate && RANK[k] > RANK[kind])) {
        kind = k;
        rate = r;
      }
    };
    if (rates.nightStartMin !== null && rates.nightEndMin !== null && inWindow(mod, rates.nightStartMin, rates.nightEndMin)) {
      consider('night', rates.nightCents);
    }
    if (dow === 6) consider('saturday', rates.saturdayCents);
    if (dow === 0) consider('sunday', rates.sundayCents);

    const b = buckets.get(kind) ?? { rate, minutes: 0 };
    b.minutes++;
    buckets.set(kind, b);
  }

  const segments: PaySegment[] = (['base', 'night', 'saturday', 'sunday'] as const)
    .filter((k) => buckets.has(k))
    .map((k) => {
      const b = buckets.get(k)!;
      // Integer cents: minutes × cents/hour ÷ 60, rounded half up per segment.
      return { kind: k, rateCents: b.rate, minutes: b.minutes, cents: Math.floor((b.minutes * b.rate + 30) / 60) };
    });
  return {
    paidMinutes: total - brk,
    grossCents: segments.reduce((s, x) => s + x.cents, 0),
    segments,
  };
}

export const PAY_KIND_LABEL: Record<PayKind, string> = {
  base: 'Ordinary',
  night: 'Night',
  saturday: 'Saturday',
  sunday: 'Sunday',
};
