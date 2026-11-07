import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { useApp } from './AppContext';

type Kind = 'tap' | 'success' | 'warning' | 'error' | 'select';

/** Haptics that respect the in-app toggle. Failures (e.g. Simulator) are non-fatal. */
export function useHaptics() {
  const { settings } = useApp();
  return useCallback(
    (kind: Kind) => {
      if (!settings.hapticsEnabled) return;
      const p =
        kind === 'tap'
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          : kind === 'select'
            ? Haptics.selectionAsync()
            : Haptics.notificationAsync(
                kind === 'success'
                  ? Haptics.NotificationFeedbackType.Success
                  : kind === 'warning'
                    ? Haptics.NotificationFeedbackType.Warning
                    : Haptics.NotificationFeedbackType.Error,
              );
      p.catch((e: unknown) => console.warn('Haptics unavailable', e));
    },
    [settings.hapticsEnabled],
  );
}
