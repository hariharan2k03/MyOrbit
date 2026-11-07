import { err, ok, type Result } from './result';

export const LIMITS = {
  title: 120,
  name: 80,
  notes: 1000,
  code: 20,
} as const;

/** Trims, strips control characters and enforces a length limit. */
export function cleanText(
  value: string | null | undefined,
  label: string,
  max: number,
  opts: { required?: boolean } = {},
): Result<string> {
  const cleaned = (value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (opts.required && cleaned.length === 0) return err(`${label} is required.`);
  if (cleaned.length > max) return err(`${label} must be ${max} characters or fewer.`);
  return ok(cleaned);
}

export function intInRange(value: number, label: string, min: number, max: number): Result<number> {
  if (!Number.isInteger(value) || value < min || value > max) {
    return err(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return ok(value);
}

export function parseIntInput(input: string, label: string, min: number, max: number): Result<number> {
  const t = input.trim();
  if (!/^\d+$/.test(t)) return err(`${label} must be a whole number.`);
  return intInRange(Number(t), label, min, max);
}
