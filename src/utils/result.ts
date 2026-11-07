export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: string): Result<T> => ({ ok: false, error });

/** Unwraps a Result, throwing a ValidationError on failure. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new ValidationError(result.error);
  return result.value;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
