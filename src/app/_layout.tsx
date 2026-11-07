import { router, Stack } from 'expo-router';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { syncStaleFeeds } from '@/database/repositories/calendarFeeds';
import { AppLockGate } from '@/services/AppLock';
import { AppProvider, onDataChanged, useApp, useAppBootstrap, useFallbackColors } from '@/services/AppContext';
import { syncTimerActivity } from '@/services/liveActivitySync';
import { syncReminders, useReminderTaps } from '@/services/reminderSync';
import { refreshWidgets } from '@/services/widgetSync';
import { takeQueuedActions } from '@/services/intentQueue';
import { applyIntentActions } from '@/features/intents/intentActions';
import { todayKey } from '@/utils/time';

export default function RootLayout() {
  const { state, retry } = useAppBootstrap();
  const fallback = useFallbackColors();

  if (state.status !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: fallback.background }]}>
        {state.status === 'loading' ? (
          <ActivityIndicator color={fallback.textSecondary} />
        ) : (
          <View style={{ gap: 12, padding: 24, alignItems: 'center' }}>
            <Text style={{ color: fallback.text, fontSize: 17, fontWeight: '600' }}>MyOrbit couldn’t open your data</Text>
            <Text style={{ color: fallback.textSecondary, textAlign: 'center' }}>{state.error.message}</Text>
            <Pressable accessibilityRole="button" onPress={retry} style={[styles.retry, { backgroundColor: fallback.accent }]}>
              <Text style={{ color: fallback.onAccent, fontWeight: '600' }}>Try again</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppProvider db={state.db} initialSettings={state.settings}>
        <ThemedStack />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
  const { colors, isDark, db, notifyDataChanged, settings } = useApp();
  const hideAmounts = settings.hideAmountsInWidgets;

  // Keep Home Screen / Lock Screen widgets in step with the data (debounced). Also runs on
  // foreground, which is when tasks ticked in the widget get completed in the database.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () =>
          void refreshWidgets(db, { hideAmountsInWidgets: hideAmounts }).then((completed) => {
            if (completed > 0) notifyDataChanged('tasks');
          }),
        1000,
      );
    };
    schedule();
    const unsubscribe = onDataChanged(schedule);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') schedule();
    });
    return () => {
      unsubscribe();
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [db, hideAmounts, notifyDataChanged]);

  // Apply anything Siri / Shortcuts queued while MyOrbit was closed.
  useEffect(() => {
    const run = () =>
      void (async () => {
        const actions = takeQueuedActions();
        if (actions.length === 0) return;
        const result = await applyIntentActions(db, actions, todayKey());
        notifyDataChanged('all');
        if (result.openTimer) router.push('/focus');
        if (result.timerBusy) Alert.alert('A timer is already running', 'Finish or end it before starting another.');
        if (result.added.length > 0) Alert.alert('Added from Siri', result.added.join('\n'));
      })();
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [db, notifyDataChanged]);
  // Reminders are re-planned from the data whenever it or the reminder settings change (debounced),
  // and on foreground, so a reminder never outlives an edited or deleted shift, task or assessment.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void syncReminders(db, settings), 1500);
    };
    schedule();
    const unsubscribe = onDataChanged(schedule);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') schedule();
    });
    return () => {
      unsubscribe();
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [db, settings]);
  useReminderTaps(useCallback((url: string) => void Linking.openURL(url), []));

  // Timer sessions drive the Lock Screen / Dynamic Island Live Activity. Re-checked on
  // foreground too, so a timer that finished while MyOrbit was closed is dismissed.
  useEffect(() => {
    const sync = () => void syncTimerActivity(db);
    sync();
    const unsubscribe = onDataChanged((d) => {
      if (d === 'activity' || d === 'all') sync();
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') sync();
    });
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, [db]);
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch((e: unknown) => console.warn('SystemUI', e));
  }, [colors.background]);

  // Refresh subscribed calendars (e.g. uni timetable) on launch and when returning to the app, if stale.
  useEffect(() => {
    const refresh = () => void syncStaleFeeds(db).then(() => notifyDataChanged('all'));
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [db, notifyDataChanged]);

  const modal = { presentation: 'modal' as const };
  return (
    <AppLockGate>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          // Header items sit on iOS glass buttons; text-coloured tint keeps them readable.
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          headerBackButtonDisplayMode: 'minimal',
          // Each screen owns its status bar (UIViewControllerBasedStatusBarAppearance), so set
          // it per screen; a root-level StatusBar is lost after a modal is dismissed.
          statusBarStyle: isDark ? 'light' : 'dark',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="shift/[id]" options={modal} />
        <Stack.Screen name="workplace/[id]" options={modal} />
        <Stack.Screen name="expense/[id]" options={modal} />
        <Stack.Screen name="income/[id]" options={modal} />
        <Stack.Screen name="budget/[id]" options={modal} />
        <Stack.Screen name="subject/[id]" options={modal} />
        <Stack.Screen name="assessment/[id]" options={modal} />
        <Stack.Screen name="study-log" options={modal} />
        <Stack.Screen name="task/[id]" options={modal} />
        <Stack.Screen name="habit/[id]" options={modal} />
        <Stack.Screen name="tasks" options={{ title: 'Tasks' }} />
        <Stack.Screen name="habits" options={{ title: 'Habits' }} />
        <Stack.Screen name="calendar" options={{ title: 'Calendar' }} />
        <Stack.Screen name="insights" options={{ title: 'Insights' }} />
        <Stack.Screen name="shifts" options={{ title: 'My Shifts' }} />
        <Stack.Screen name="calendar-feeds" options={{ title: 'Subscribed Calendars' }} />
        <Stack.Screen name="reminders" options={{ title: 'Reminders' }} />
        <Stack.Screen name="backup" options={{ title: 'Backup & Restore' }} />
        <Stack.Screen name="assistant" options={{ title: 'Personal AI' }} />
        <Stack.Screen name="workplaces" options={{ title: 'Workplaces & Pay Rates' }} />
        <Stack.Screen name="transactions" options={{ title: 'Transactions' }} />
        <Stack.Screen name="subject-detail/[id]" options={{ title: 'Subject' }} />
        <Stack.Screen name="focus" options={{ ...modal, title: 'Focus' }} />
      </Stack>
    </AppLockGate>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  retry: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
});
