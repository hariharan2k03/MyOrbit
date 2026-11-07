import { requireOptionalNativeModule } from 'expo';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { RawDraft } from '@/features/ai/quickAdd';

export type AIAvailability = 'available' | 'deviceNotEligible' | 'appleIntelligenceNotEnabled' | 'modelNotReady' | 'unavailable' | 'unsupportedOS';

interface NativeAI {
  availability(): AIAvailability;
  respond(instructions: string, prompt: string): Promise<string>;
  parseQuickAdd(instructions: string, text: string): Promise<RawDraft>;
}

// Optional: missing in tests, on older builds and on other platforms — the AI then simply isn't offered.
const native = requireOptionalNativeModule<NativeAI>('MyOrbitAI');

export function aiAvailability(): AIAvailability {
  try {
    return native?.availability() ?? 'unsupportedOS';
  } catch {
    return 'unavailable';
  }
}

/** Re-checks when the app returns to the foreground (e.g. after turning on Apple Intelligence). */
export function useAIAvailability(): AIAvailability {
  const [state, setState] = useState<AIAvailability>(aiAvailability);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setState(aiAvailability()));
    return () => sub.remove();
  }, []);
  return state;
}

export const AI_UNAVAILABLE_MESSAGE: Record<Exclude<AIAvailability, 'available'>, string> = {
  deviceNotEligible: 'This iPhone doesn’t support Apple Intelligence.',
  appleIntelligenceNotEnabled: 'Turn on Apple Intelligence in iOS Settings to use Personal AI.',
  modelNotReady: 'Apple Intelligence is still downloading. Try again in a little while.',
  unavailable: 'Apple Intelligence isn’t available right now.',
  unsupportedOS: 'Personal AI needs iOS 26 or later with Apple Intelligence.',
};

export async function askAI(instructions: string, prompt: string): Promise<string> {
  if (!native) throw new Error(AI_UNAVAILABLE_MESSAGE.unsupportedOS);
  return (await native.respond(instructions, prompt)).trim();
}

export async function parseQuickAdd(instructions: string, text: string): Promise<RawDraft> {
  if (!native) throw new Error(AI_UNAVAILABLE_MESSAGE.unsupportedOS);
  return native.parseQuickAdd(instructions, text);
}
