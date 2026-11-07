import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';
import { useApp } from './AppContext';

/**
 * App Lock hides content until the user authenticates with Face ID (or the
 * device passcode as fallback). This is access control only — it does not
 * encrypt the database; iOS Data Protection encrypts files at rest.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { settings, colors } = useApp();
  const [lockedState, setLocked] = useState(settings.appLockEnabled);
  // Turning App Lock off in Settings unlocks immediately.
  const locked = settings.appLockEnabled && lockedState;
  const [message, setMessage] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  // Auto-prompt once each time the lock screen appears (not on every re-render).
  const prompted = useRef(false);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock MyOrbit',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });
    if (result.success) {
      setMessage(null);
      setLocked(false);
    } else if (result.error !== 'user_cancel' && result.error !== 'system_cancel' && result.error !== 'app_cancel') {
      setMessage(result.error === 'not_enrolled' ? 'Set up Face ID or a passcode in iOS Settings.' : 'Authentication failed. Try again.');
    }
  }, []);

  useEffect(() => {
    if (!settings.appLockEnabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current !== null) {
        if (Date.now() - backgroundedAt.current >= settings.autoLockSeconds * 1000) {
          prompted.current = false;
          setLocked(true);
        }
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [settings.appLockEnabled, settings.autoLockSeconds]);

  if (!locked) return <>{children}</>;
  return (
    <View
      style={[styles.lock, { backgroundColor: colors.background }]}
      onLayout={() => {
        if (prompted.current) return;
        prompted.current = true;
        void unlock();
      }}
    >
      <Icon name="lock.fill" color={colors.accent} size={40} />
      <Text variant="title">MyOrbit is locked</Text>
      {message ? (
        <Text tone="secondary" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}
      <Button title="Unlock" icon="faceid" onPress={() => void unlock()} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Checks whether this device can use App Lock before the user turns it on. */
export async function canUseAppLock(): Promise<{ ok: boolean; reason?: string }> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) return { ok: false, reason: 'Set a device passcode in iOS Settings first.' };
  return { ok: true };
}

export async function confirmIdentity(reason: string): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
  return r.success;
}

const styles = StyleSheet.create({
  lock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xxl },
});
