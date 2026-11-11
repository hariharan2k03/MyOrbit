import { TAX_RESIDENCY_LABEL, type TaxResidency } from '@/features/finance/auTax';
import { CLOCK_IN_EARLY_OPTIONS, CLOCK_OUT_EARLY_OPTIONS } from '@/features/work/clock';
import { isValidDateKey } from '@/utils/time';
import type { SqlDb } from '../types';

/**
 * Typed app settings stored in SQLite. Security-sensitive values (PIN hash,
 * backup keys) never go here — they live in the Keychain via SecureStore.
 */
export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  displayName: string;
  hideAmountsInWidgets: boolean;
  appLockEnabled: boolean;
  autoLockSeconds: number;
  hapticsEnabled: boolean;
  notificationsEnabled: boolean;
  dashboardCards: string[];
  /** Used for after-tax pay estimates. */
  taxResidency: TaxResidency;
  /** Weekly paid-hours goal shown on Work (0 = no goal). */
  weeklyHoursTarget: number;
  /** Minutes before a shift starts to remind (0 = off). Only applies while notificationsEnabled. */
  shiftReminderMinutes: number;
  /** The day before (9:00 AM) and 2 hours before an assessment is due. */
  remindAssessments: boolean;
  /** 9:00 AM on a task's due date. */
  remindTasks: boolean;
  /** A daily habit check-in at habitReminderTime. */
  remindHabits: boolean;
  /** 24-hour "HH:mm". */
  habitReminderTime: string;
  /** Any date in a week that starts a pay fortnight (for fortnightly pay totals). */
  payFortnightAnchor: string;
  /** Your name as it's written on rosters, plus variants, comma-separated ("HARIHARAN, Hari"). */
  rosterNames: string;
  /** Clock In unlocks this many minutes before a shift starts. */
  clockInEarlyMinutes: number;
  /** Clock Out unlocks this many minutes before a shift ends. */
  clockOutEarlyMinutes: number;
  /** Notifications when Clock In / Clock Out unlock, and if you forget to clock out. */
  remindClock: boolean;
  /** Unpaid break added to shifts imported from a roster. */
  rosterBreakMinutes: number;
}

export const SHIFT_REMINDER_OPTIONS = [0, 15, 30, 60, 120, 180] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  displayName: '',
  hideAmountsInWidgets: true,
  appLockEnabled: false,
  autoLockSeconds: 60,
  hapticsEnabled: true,
  notificationsEnabled: false,
  dashboardCards: ['glance', 'focus', 'money', 'study', 'week'],
  taxResidency: 'resident',
  weeklyHoursTarget: 0,
  shiftReminderMinutes: 60,
  remindAssessments: true,
  remindTasks: true,
  remindHabits: false,
  habitReminderTime: '20:00',
  payFortnightAnchor: '2026-01-05',
  rosterNames: '',
  clockInEarlyMinutes: 10,
  clockOutEarlyMinutes: 30,
  remindClock: true,
  rosterBreakMinutes: 0,
};

type Key = keyof AppSettings;

function isValid<K extends Key>(key: K, value: unknown): value is AppSettings[K] {
  const def = DEFAULT_SETTINGS[key];
  if (Array.isArray(def)) return Array.isArray(value) && value.every((v) => typeof v === 'string');
  if (key === 'theme') return value === 'system' || value === 'light' || value === 'dark';
  if (key === 'taxResidency') return typeof value === 'string' && value in TAX_RESIDENCY_LABEL;
  if (key === 'shiftReminderMinutes') return (SHIFT_REMINDER_OPTIONS as readonly unknown[]).includes(value);
  if (key === 'habitReminderTime') return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (key === 'payFortnightAnchor') return typeof value === 'string' && isValidDateKey(value);
  if (key === 'clockInEarlyMinutes') return (CLOCK_IN_EARLY_OPTIONS as readonly unknown[]).includes(value);
  if (key === 'clockOutEarlyMinutes') return (CLOCK_OUT_EARLY_OPTIONS as readonly unknown[]).includes(value);
  if (key === 'rosterBreakMinutes') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 120;
  if (key === 'rosterNames') return typeof value === 'string' && value.length <= 200;
  if (key === 'weeklyHoursTarget') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 80;
  return typeof value === typeof def;
}

export async function loadSettings(db: SqlDb): Promise<AppSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isValid(key as Key, parsed)) continue;
      (settings as unknown as Record<string, unknown>)[key] = key === 'dashboardCards' ? migrateCards(parsed as string[]) : parsed;
    } catch {
      // A corrupt value falls back to the default; it is overwritten on next save.
      continue;
    }
  }
  return settings;
}

export async function saveSetting<K extends Key>(db: SqlDb, key: K, value: AppSettings[K]): Promise<void> {
  if (!isValid(key, value)) throw new Error(`Invalid value for setting ${key}.`);
  await db.runAsync(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), Date.now()],
  );
}

/** Maps dashboard card ids from before the redesign onto current ones, dropping unknowns. */
export function migrateCards(cards: string[]): string[] {
  const renamed: Record<string, string> = { schedule: 'focus', tasks: 'glance', habits: 'glance' };
  const known = new Set(DEFAULT_SETTINGS.dashboardCards);
  const out: string[] = [];
  for (const c of cards) {
    const id = renamed[c] ?? c;
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The roster names setting as a list ("HARIHARAN, Hari" → ["HARIHARAN", "Hari"]). */
export function rosterNameList(setting: string): string[] {
  return setting
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length >= 2);
}
