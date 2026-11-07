import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { ChoiceField, FormSection, Segmented, SwitchField, TextField } from '@/components/form';
import { Card, Divider, Icon, ListRow, Row, Screen, Text } from '@/components/ui';
import { DEFAULT_SETTINGS, type AppSettings } from '@/database/repositories/settings';
import { canUseAppLock, confirmIdentity } from '@/services/AppLock';
import { useAIAvailability } from '@/services/ai';
import { useApp } from '@/services/AppContext';
import { useQuery } from '@/services/useQuery';
import { loadInsights } from '@/features/insights/insightsData';
import { spacing } from '@/theme/tokens';

const CARD_LABELS: Record<string, string> = {
  glance: 'Today at a Glance',
  focus: 'Today’s Focus',
  money: 'Money & budget',
  study: 'Study progress',
  week: 'Weekly productivity',
};

export default function SettingsScreen() {
  const { settings, updateSetting, colors } = useApp();
  const [name, setName] = useState(settings.displayName);
  const aiReady = useAIAvailability() === 'available';

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    updateSetting(key, value).catch((e: unknown) => {
      console.error('Setting save failed', e);
      Alert.alert('Couldn’t save setting', 'Please try again.');
    });

  const toggleLock = async (on: boolean) => {
    if (on) {
      const check = await canUseAppLock();
      if (!check.ok) return Alert.alert('App Lock unavailable', check.reason);
    }
    // Confirm with Face ID/passcode for both enabling and disabling.
    if (!(await confirmIdentity(on ? 'Turn on App Lock' : 'Turn off App Lock'))) return;
    await set('appLockEnabled', on);
  };

  const cards = settings.dashboardCards;
  const hidden = DEFAULT_SETTINGS.dashboardCards.filter((c) => !cards.includes(c));
  const moveCard = (i: number, dir: -1 | 1) => {
    const next = [...cards];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    void set('dashboardCards', next);
  };

  return (
    <Screen title="More">
      <ProfileCard name={settings.displayName} />
      <FormSection title="Organise">
        <View style={styles.rows}>
          {aiReady ? (
            <>
              <ListRow icon="sparkles" tone="accent" title="Personal AI" subtitle="Ask about your data, quick-add in plain words" onPress={() => router.push('/assistant')} />
              <Divider />
            </>
          ) : null}
          <ListRow icon="chart.bar.fill" tone="accent" title="Insights" onPress={() => router.push('/insights')} />
          <Divider />
          <ListRow icon="checklist" tone="tasks" title="Tasks" onPress={() => router.push('/tasks')} />
          <Divider />
          <ListRow icon="flame.fill" tone="pink" title="Habits" onPress={() => router.push('/habits')} />
          <Divider />
          <ListRow icon="calendar" tone="sky" title="Calendar" onPress={() => router.push('/calendar')} />
          <Divider />
          <ListRow icon="list.bullet.rectangle" tone="money" title="Transactions" onPress={() => router.push('/transactions')} />
        </View>
      </FormSection>

      <FormSection title="Appearance">
        <View style={{ padding: spacing.md }}>
          <Segmented
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={settings.theme}
            onChange={(v) => void set('theme', v)}
          />
        </View>
      </FormSection>

      <FormSection title="Personal">
        <TextField label="Your name" value={name} onChangeText={setName} onEndEditing={() => void set('displayName', name.trim().slice(0, 40))} placeholder="For the greeting" maxLength={40} />
        <SwitchField label="Haptics" value={settings.hapticsEnabled} onChange={(v) => void set('hapticsEnabled', v)} last />
      </FormSection>

      <FormSection title="Home dashboard" footer="Choose which cards appear on Home and in what order.">
        {cards.map((c, i) => (
          <View key={c}>
            {i > 0 ? <Divider /> : null}
            <Row style={{ paddingHorizontal: spacing.lg, minHeight: 48 }}>
              <Text variant="callout" style={{ flex: 1 }}>
                {CARD_LABELS[c] ?? c}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Move ${CARD_LABELS[c]} up`} disabled={i === 0} onPress={() => moveCard(i, -1)} hitSlop={8}>
                <Icon name="chevron.up" color={i === 0 ? colors.border : colors.accent} size={16} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Move ${CARD_LABELS[c]} down`} disabled={i === cards.length - 1} onPress={() => moveCard(i, 1)} hitSlop={8}>
                <Icon name="chevron.down" color={i === cards.length - 1 ? colors.border : colors.accent} size={16} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Hide ${CARD_LABELS[c]}`}
                onPress={() =>
                  void set(
                    'dashboardCards',
                    cards.filter((x) => x !== c),
                  )
                }
                hitSlop={8}
              >
                <Icon name="minus.circle.fill" color={colors.danger} size={18} />
              </Pressable>
            </Row>
          </View>
        ))}
        {hidden.length > 0 ? (
          <ChoiceField
            label="Add card"
            options={hidden.map((c) => ({
              value: c,
              label: CARD_LABELS[c] ?? c,
            }))}
            value={null}
            onChange={(c) => void set('dashboardCards', [...cards, c])}
            last
          />
        ) : null}
      </FormSection>

      <FormSection title="Notifications">
        <View style={styles.rows}>
          <ListRow
            icon="bell.badge.fill"
            tone="expense"
            title="Reminders"
            value={settings.notificationsEnabled ? 'On' : 'Off'}
            valueTone="secondary"
            onPress={() => router.push('/reminders')}
          />
        </View>
      </FormSection>

      <FormSection title="Data" footer="Your data lives only on this iPhone. Back it up before changing phones or reinstalling MyOrbit.">
        <View style={styles.rows}>
          <ListRow icon="externaldrive.fill.badge.timemachine" tone="sky" title="Backup & Restore" onPress={() => router.push('/backup')} />
        </View>
      </FormSection>

      <FormSection title="Widgets" footer="Widgets show today’s schedule, tasks and habits. Money stays off widgets — including the Lock Screen — unless you turn this on.">
        <SwitchField label="Show money in widgets" value={!settings.hideAmountsInWidgets} onChange={(v) => void set('hideAmountsInWidgets', !v)} last />
      </FormSection>

      <FormSection
        title="Privacy & security"
        footer="App Lock hides MyOrbit until you unlock with Face ID or your passcode. Your data is stored only on this iPhone and protected by iOS encryption when the device is locked."
      >
        <SwitchField label="App Lock" value={settings.appLockEnabled} onChange={(v) => void toggleLock(v)} last={!settings.appLockEnabled} />
        {settings.appLockEnabled ? (
          <ChoiceField
            label="Lock after"
            options={[
              { value: 0, label: 'Immediately' },
              { value: 60, label: '1 min' },
              { value: 300, label: '5 min' },
              { value: 900, label: '15 min' },
            ]}
            value={settings.autoLockSeconds}
            onChange={(v) => void set('autoLockSeconds', v)}
            last
          />
        ) : null}
      </FormSection>

      <FormSection title="About">
        <View style={styles.rows}>
          <ListRow title="Version" value={Constants.expoConfig?.version ?? '—'} />
          <Divider />
          <ListRow title="Data" value="On this iPhone only" />
          <Divider />
          <ListRow title="Tracking & ads" value="None" />
        </View>
      </FormSection>
    </Screen>
  );
}

/** Profile header: initials avatar and three real stats (no invented achievements). */
function ProfileCard({ name }: { name: string }) {
  const { colors } = useApp();
  const query = useQuery((db) => loadInsights(db));
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '🙂';
  return (
    <Card style={{ alignItems: 'center' }}>
      <LinearGradient colors={colors.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
        <Text style={{ fontSize: 30, fontWeight: '700' }} color="#FFFFFF">
          {initials}
        </Text>
      </LinearGradient>
      <Text variant="title">{name.trim() || 'Add your name below'}</Text>
      <Text variant="footnote" tone="secondary">
        Stay consistent. Grow every day.
      </Text>
      {query.data ? (
        <Row style={{ alignSelf: 'stretch', marginTop: spacing.sm }}>
          <ProfileStat value={String(query.data.activeDays30)} label="Days active (30d)" />
          <ProfileStat value={String(query.data.habitsTotal)} label="Habits" />
          <ProfileStat value={String(query.data.tasksDone)} label="Tasks this week" />
        </Row>
      ) : null}
    </Card>
  );
}

function ProfileStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text variant="title">{value}</Text>
      <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ListRow has no padding of its own; FormSection groups are edge-to-edge.
  rows: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
