import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { ChoiceField, FormSection, SwitchField, TextField } from '@/components/form';
import { Button, Screen, Text } from '@/components/ui';
import type { AppSettings } from '@/database/repositories/settings';
import { CLOCK_IN_EARLY_OPTIONS, CLOCK_OUT_EARLY_OPTIONS } from '@/features/work/clock';
import { useApp } from '@/services/AppContext';
import { canUseAppLock, confirmIdentity } from '@/services/AppLock';
import { parseIntInput } from '@/utils/validation';

const minutesLabel = (m: number) => (m === 0 ? 'At start' : `${m} min`);
const AUTO_LOCK = [
  { value: 0, label: 'Immediately' },
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 900, label: '15 min' },
] as const;

/** Clock in/out rules, roster name, clock reminders and Face ID lock. */
export default function WorkSettingsScreen() {
  const { settings, updateSetting } = useApp();
  const [names, setNames] = useState(settings.rosterNames);
  const [breakMins, setBreakMins] = useState(String(settings.rosterBreakMinutes));

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    updateSetting(key, value).catch((e: unknown) => {
      console.error('Setting save failed', e);
      Alert.alert('Couldn’t save setting', 'Please try again.');
    });

  const toggleLock = async (on: boolean) => {
    if (on) {
      const check = await canUseAppLock();
      if (!check.ok) return Alert.alert('Face ID lock unavailable', check.reason);
    }
    if (!(await confirmIdentity(on ? 'Turn on Face ID lock' : 'Turn off Face ID lock'))) return;
    await set('appLockEnabled', on);
  };

  return (
    <Screen largeTitle={false}>
      <FormSection title="Clock in & out" footer={`Clock In unlocks ${minutesLabel(settings.clockInEarlyMinutes).toLowerCase()} before a shift starts; Clock Out unlocks ${minutesLabel(settings.clockOutEarlyMinutes).toLowerCase()} before it ends.`}>
        <ChoiceField
          label="Clock in opens before start"
          options={CLOCK_IN_EARLY_OPTIONS.map((m) => ({ value: m, label: minutesLabel(m) }))}
          value={settings.clockInEarlyMinutes}
          onChange={(v) => void set('clockInEarlyMinutes', v)}
        />
        <ChoiceField
          label="Clock out opens before end"
          options={CLOCK_OUT_EARLY_OPTIONS.map((m) => ({ value: m, label: minutesLabel(m) }))}
          value={settings.clockOutEarlyMinutes}
          onChange={(v) => void set('clockOutEarlyMinutes', v)}
          last
        />
      </FormSection>

      <FormSection
        title="Notifications"
        footer={
          settings.notificationsEnabled
            ? 'When Clock In and Clock Out open (with a button to do it from the notification), and if you’re still clocked in 15 minutes after a shift ends. Roster changes are notified when you save them.'
            : 'Turn on reminders first — they’re off for the whole app.'
        }
      >
        <SwitchField label="Clock in/out reminders" value={settings.remindClock} onChange={(v) => void set('remindClock', v)} last />
      </FormSection>
      {!settings.notificationsEnabled ? <Button title="Open Reminders" kind="secondary" icon="bell" onPress={() => router.push('/reminders' as Href)} /> : null}

      <FormSection title="Roster" footer="Only shifts next to this name are taken from a roster. Add variants separated by commas.">
        <TextField
          label="Name on roster"
          value={names}
          onChangeText={setNames}
          onEndEditing={() => void set('rosterNames', names.trim())}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="HARIHARAN"
          maxLength={200}
        />
        <TextField
          label="Unpaid break"
          value={breakMins}
          onChangeText={setBreakMins}
          onEndEditing={() => {
            const b = parseIntInput(breakMins || '0', 'Unpaid break', 0, 120);
            if (b.ok) void set('rosterBreakMinutes', b.value);
            else Alert.alert('Check the break', b.error);
          }}
          keyboardType="number-pad"
          placeholder="minutes per imported shift"
          maxLength={3}
          last
        />
      </FormSection>
      <Button title="Upload Roster" icon="doc.text.viewfinder" onPress={() => router.push('/roster-import' as Href)} />

      <FormSection title="Privacy" footer="Face ID (or your passcode) is needed to open MyOrbit, and the app is hidden in the app switcher. Notification buttons also need your iPhone unlocked.">
        <SwitchField label="Face ID lock" value={settings.appLockEnabled} onChange={(v) => void toggleLock(v)} last={!settings.appLockEnabled} />
        {settings.appLockEnabled ? (
          <ChoiceField
            label="Lock after leaving the app"
            options={AUTO_LOCK.map((o) => ({ value: o.value, label: o.label }))}
            value={settings.autoLockSeconds}
            onChange={(v) => void set('autoLockSeconds', v)}
            last
          />
        ) : null}
      </FormSection>
      <Text variant="footnote" tone="tertiary">
        Your roster photos are read on this iPhone and never uploaded.
      </Text>
    </Screen>
  );
}
