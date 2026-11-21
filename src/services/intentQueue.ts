import { requireOptionalNativeModule } from 'expo';
import { parseIntentAction, type IntentAction } from '@/features/intents/intentActions';

// Missing in tests and older builds; then there's simply nothing queued.
const native = requireOptionalNativeModule<{ takePendingActions(): string[]; lastApplePayRun?: () => string | null }>('MyOrbitIntents');

export interface ApplePayRun {
  at: number;
  merchant: string;
  amount: string;
  card: string;
  result: 'saved' | 'noAmount';
}

/** The last time the Apple Pay automation ran MyOrbit, and what Wallet passed in. Null if never. */
export function lastApplePayRun(): ApplePayRun | null {
  try {
    const json = native?.lastApplePayRun?.();
    if (!json) return null;
    const r = JSON.parse(json) as Partial<ApplePayRun>;
    if (typeof r.at !== 'number') return null;
    return { at: r.at, merchant: String(r.merchant ?? ''), amount: String(r.amount ?? ''), card: String(r.card ?? ''), result: r.result === 'saved' ? 'saved' : 'noAmount' };
  } catch {
    return null;
  }
}

/** Takes (and clears) actions queued by Siri / Shortcuts while MyOrbit was closed. */
export function takeQueuedActions(): IntentAction[] {
  try {
    return (native?.takePendingActions() ?? []).map(parseIntentAction).filter((a): a is IntentAction => a !== null);
  } catch (e) {
    console.warn('Reading queued actions failed', e);
    return [];
  }
}
