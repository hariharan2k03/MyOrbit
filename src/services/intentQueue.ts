import { requireOptionalNativeModule } from 'expo';
import { parseIntentAction, type IntentAction } from '@/features/intents/intentActions';

// Missing in tests and older builds; then there's simply nothing queued.
const native = requireOptionalNativeModule<{ takePendingActions(): string[] }>('MyOrbitIntents');

/** Takes (and clears) actions queued by Siri / Shortcuts while MyOrbit was closed. */
export function takeQueuedActions(): IntentAction[] {
  try {
    return (native?.takePendingActions() ?? []).map(parseIntentAction).filter((a): a is IntentAction => a !== null);
  } catch (e) {
    console.warn('Reading queued actions failed', e);
    return [];
  }
}
