import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, View } from 'react-native';
import { ChoiceField, FormSection, SwitchField, TimeField } from '@/components/form';
import { Button, Card, Divider, GradientTile, Icon, ListRow, Row, Screen, Text } from '@/components/ui';
import { SHIFT_REMINDER_OPTIONS, type AppSettings } from '@/database/repositories/settings';
import { leadLabel, planReminders } from '@/features/reminders/planReminders';
import { useApp } from '@/services/AppContext';
import { hasNotificationPermission, requestNotificationPermission } from '@/services/reminderSync';
import { useQuery } from '@/services/useQuery';
import { spacing } from '@/theme/tokens';
import { formatClock, formatDateKey, toDateKey, todayKey } from '@/utils/time';

function whenLabel(ms: number): string {
  const day = toDateKey(new Date(ms));
  return `${day === todayKey() ? 'Today' : formatDateKey(day, { weekday: true })}, ${formatClock(ms)}`;
}

/**
 * Local reminders only: they're scheduled on this iPhone from your own data and
 * never leave it. Re-planned automatically whenever the data changes.
 */
export default function RemindersScreen() {
  const { settings, updateSetting, colors } = useApp();
  const [permitted, setPermitted] = useState<boolean | null>(null);
  const { notificationsEnabled, shiftReminderMinutes, remindAssessments, remindTasks, remindHabits, habitReminderTime } = settings;
  const upcoming = useQuery(
    (db) => planReminders(db, { notificationsEnabled, shiftReminderMinutes, remindAssessments, remindTasks, remindHabits, habitReminderTime }),
    [notificationsEnabled, shiftReminderMinutes, remindAssessments, remindTasks, remindHabits, habitReminderTime],
  );

  // Re-check on return from iOS Settings, where the user may have changed it.
  useEffect(() => {
    const check = () => void hasNotificationPermission().then(setPermitted);
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    void updateSetting(key, value).catch(() => Alert.alert('Couldn’t save', 'Please try again.'));

  const toggleAll = async (on: boolean) => {
    if (on && !(await requestNotificationPermission())) {
      setPermitted(false);
      Alert.alert('Notifications are off for MyOrbit', 'Turn on notifications for MyOrbit in iOS Settings to get reminders.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    setPermitted(on ? true : permitted);
    set('notificationsEnabled', on);
  };

  const blocked = settings.notificationsEnabled && permitted === false;
  const on = settings.notificationsEnabled;

  return (
    <Screen largeTitle={false}>
      <Card>
        <Row>
          <GradientTile icon="bell.badge.fill" tone="expense" size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">Reminders</Text>
            <Text variant="footnote" tone="secondary">
              Scheduled on this iPhone from your own data. Nothing is sent to a server.
            </Text>
          </View>
        </Row>
      </Card>

      <FormSection>
        <SwitchField label="Allow reminders" value={on} onChange={(v) => void toggleAll(v)} last />
      </FormSection>

      {blocked ? (
        <Card>
          <Row gap={8}>
            <Icon name="exclamationmark.triangle.fill" color={colors.warning} size={16} />
            <Text variant="subhead" style={{ flex: 1 }}>
              iOS is blocking MyOrbit’s notifications, so no reminders will appear.
            </Text>
          </Row>
          <Button title="Open iOS Settings" kind="secondary" onPress={() => void Linking.openSettings()} />
        </Card>
      ) : null}

      {on ? (
        <>
          <FormSection title="Shifts" footer="A reminder before each scheduled shift, with the workplace and times.">
            <ChoiceField
              options={SHIFT_REMINDER_OPTIONS.map((m) => ({ value: m, label: m === 0 ? 'Off' : leadLabel(m).replace(' minutes', ' min').replace(' hours', ' hr').replace(' hour', ' hr') }))}
              value={settings.shiftReminderMinutes}
              onChange={(m) => set('shiftReminderMinutes', m)}
              last
            />
          </FormSection>
          <FormSection title="Study & tasks">
            <SwitchField label="Assessments (day before + 2 hours before)" value={settings.remindAssessments} onChange={(v) => set('remindAssessments', v)} />
            <SwitchField label="Tasks (9:00 AM on the due date)" value={settings.remindTasks} onChange={(v) => set('remindTasks', v)} last />
          </FormSection>
          <FormSection title="Habits" footer="One daily check-in while you have active habits.">
            <SwitchField label="Daily habit check-in" value={settings.remindHabits} onChange={(v) => set('remindHabits', v)} last={!settings.remindHabits} />
            {settings.remindHabits ? <TimeField label="Time" value={settings.habitReminderTime} onChange={(v) => set('habitReminderTime', v)} last /> : null}
          </FormSection>

          <FormSection title="Coming up" footer="The next two weeks. Reminders update by themselves when you add, move or finish things.">
            <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs }}>
              {upcoming.data && upcoming.data.length > 0 ? (
                upcoming.data.slice(0, 8).map((r, i) => (
                  <View key={`${r.entityType}:${r.entityId}:${r.kind}`}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow title={r.title} subtitle={`${r.daily ? `Every day, ${formatClock(r.fireAt)}` : whenLabel(r.fireAt)} · ${r.body}`} />
                  </View>
                ))
              ) : (
                <Text variant="subhead" tone="secondary" style={{ paddingVertical: spacing.md }}>
                  Nothing in the next two weeks.
                </Text>
              )}
            </View>
          </FormSection>
        </>
      ) : null}
    </Screen>
  );
}
