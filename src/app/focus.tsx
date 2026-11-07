import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { ChoiceField, FormSection, Segmented } from '@/components/form';
import { Button, Card, Loading, ProgressBar, Screen, Text } from '@/components/ui';
import {
  endActivitySession,
  getActiveActivitySession,
  startActivitySession,
  type ActivityKind,
  type ActivitySession,
} from '@/database/repositories/activities';
import { listSubjects, startStudySession, type Subject } from '@/database/repositories/study';
import { listUpcomingShifts, type Shift } from '@/database/repositories/work';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { spacing } from '@/theme/tokens';
import { ValidationError } from '@/utils/result';
import { formatClock, formatTimeRange } from '@/utils/time';

const DURATIONS: Record<Exclude<ActivityKind, 'work'>, number[]> = {
  focus: [15, 25, 45, 60],
  break: [5, 10, 15, 30],
  study: [25, 45, 60, 90],
};

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * Focus / break / study / shift timer. State lives in SQLite (start + end
 * instants), so the countdown is correct after the app is closed or killed.
 * The 1s interval only repaints while this screen is visible.
 */
export default function FocusScreen() {
  const { kind: kindParam } = useLocalSearchParams<{ kind?: ActivityKind }>();
  const { db, colors, notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const [active, setActive] = useState<ActivitySession | null | undefined>(undefined);
  const [kind, setKind] = useState<ActivityKind>(kindParam ?? 'focus');
  const [minutes, setMinutes] = useState(() => (kindParam && kindParam !== 'work' ? DURATIONS[kindParam][1]! : 25));
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void (async () => {
      const [a, s, sh] = await Promise.all([getActiveActivitySession(db), listSubjects(db), listUpcomingShifts(db, Date.now(), 5)]);
      setActive(a);
      setSubjects(s);
      setSubjectId(s[0]?.id ?? null);
      // Only shifts that have started or start within 2 hours can be tracked.
      const eligible = sh.filter((x) => x.startAt - Date.now() < 2 * 3_600_000);
      setShifts(eligible);
      setShiftId(eligible[0]?.id ?? null);
    })();
  }, [db]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    if (active && now >= active.endsAt) {
      haptic('success');
      void endActivitySession(db, active.id, 'completed', active.endsAt).then(() => {
        setActive(null);
        notifyDataChanged('activity');
      });
    }
  }, [active, now, db, haptic, notifyDataChanged]);

  const start = async () => {
    try {
      const t = Date.now();
      let session: ActivitySession;
      if (kind === 'work') {
        const s = shifts.find((x) => x.id === shiftId);
        if (!s) throw new ValidationError('Choose a shift that starts within the next 2 hours.');
        session = await startActivitySession(db, {
          kind: 'work',
          title: s.workplaceName,
          subtitle: formatTimeRange(s.startAt, s.endAt),
          entityType: 'shift',
          entityId: s.id,
          startsAt: s.startAt,
          endsAt: s.endAt,
        });
      } else if (kind === 'study') {
        const subj = subjects.find((x) => x.id === subjectId);
        if (!subj) throw new ValidationError('Add a subject first.');
        const studyId = await startStudySession(db, subj.id, minutes, t);
        session = await startActivitySession(db, {
          kind: 'study',
          title: subj.name,
          subtitle: `${minutes} min study`,
          entityType: 'study',
          entityId: studyId,
          startsAt: t,
          endsAt: t + minutes * 60_000,
        });
      } else {
        session = await startActivitySession(db, {
          kind,
          title: kind === 'focus' ? 'Focus session' : 'Break',
          subtitle: `${minutes} min`,
          startsAt: t,
          endsAt: t + minutes * 60_000,
          nextActivity: kind === 'break' ? 'Back to focus' : null,
        });
      }
      haptic('success');
      setNow(Date.now());
      setActive(session);
      notifyDataChanged('activity');
    } catch (e) {
      haptic('error');
      if (e instanceof ValidationError) Alert.alert('Can’t start', e.message);
      else {
        console.error('Start activity failed', e);
        Alert.alert('Can’t start', 'An unexpected error occurred.');
      }
    }
  };

  const stop = () =>
    Alert.alert('End session?', kind === 'study' ? 'Time studied so far will be saved.' : undefined, [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () =>
          void endActivitySession(db, active!.id, 'cancelled').then(() => {
            setActive(null);
            notifyDataChanged('activity');
          }),
      },
    ]);

  // The timer keeps running when the sheet closes, so Close (not Cancel) is the right word.
  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
            <Text variant="headline" color={colors.text} style={{ paddingHorizontal: 4 }}>
              Close
            </Text>
          </Pressable>
        ),
      }}
    />
  );

  if (active === undefined) return <Loading />;

  if (active) {
    const total = active.endsAt - active.startsAt;
    const notStarted = now < active.startsAt;
    const remaining = notStarted ? active.startsAt - now : active.endsAt - now;
    const progress = notStarted ? 0 : (now - active.startsAt) / total;
    return (
      <Screen largeTitle={false}>
        {header}
        <View style={styles.timer}>
          <Text variant="footnote" tone="secondary" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {notStarted ? 'Starts in' : active.kind === 'work' ? 'Shift ends in' : 'Remaining'}
          </Text>
          <Text style={[styles.clock, { color: colors.text }]} accessibilityRole="timer" accessibilityLabel={`${formatRemaining(remaining)} remaining`}>
            {formatRemaining(remaining)}
          </Text>
          <Text variant="title">{active.title}</Text>
          {active.subtitle ? (
            <Text variant="subhead" tone="secondary">
              {active.subtitle}
            </Text>
          ) : null}
        </View>
        <Card>
          <ProgressBar value={progress} height={10} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="footnote" tone="secondary">
              {formatClock(active.startsAt)}
            </Text>
            <Text variant="footnote" tone="secondary">
              {formatClock(active.endsAt)}
            </Text>
          </View>
          {active.nextActivity ? (
            <Text variant="footnote" tone="tertiary">
              Next: {active.nextActivity}
            </Text>
          ) : null}
        </Card>
        <Button title="End session" kind="danger" onPress={stop} />
        <Text variant="footnote" tone="tertiary" style={{ textAlign: 'center' }}>
          The timer keeps its place if you leave or close MyOrbit.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen largeTitle={false}>
      {header}
      <Segmented
        options={[
          { value: 'focus', label: 'Focus' },
          { value: 'break', label: 'Break' },
          { value: 'study', label: 'Study' },
          { value: 'work', label: 'Shift' },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          if (k !== 'work') setMinutes(DURATIONS[k][1]!);
        }}
      />
      {kind === 'study' ? (
        <FormSection title="Subject">
          {subjects.length === 0 ? (
            <Text variant="subhead" tone="secondary" style={{ padding: spacing.lg }}>
              Add a subject on the Study tab first.
            </Text>
          ) : (
            <ChoiceField options={subjects.map((s) => ({ value: s.id, label: s.code ?? s.name, color: s.color }))} value={subjectId} onChange={setSubjectId} last />
          )}
        </FormSection>
      ) : null}
      {kind === 'work' ? (
        <FormSection title="Shift" footer="Tracks a scheduled shift from its start to finish time.">
          {shifts.length === 0 ? (
            <Text variant="subhead" tone="secondary" style={{ padding: spacing.lg }}>
              No shift is in progress or starting within 2 hours.
            </Text>
          ) : (
            <ChoiceField
              options={shifts.map((s) => ({ value: s.id, label: `${s.workplaceName} ${formatClock(s.startAt)}`, color: s.workplaceColor }))}
              value={shiftId}
              onChange={setShiftId}
              last
            />
          )}
        </FormSection>
      ) : (
        <FormSection title="Duration">
          <ChoiceField options={DURATIONS[kind].map((m) => ({ value: m, label: `${m} min` }))} value={minutes} onChange={setMinutes} last />
        </FormSection>
      )}
      <Button
        title="Start"
        icon="play.fill"
        onPress={() => void start()}
        disabled={(kind === 'study' && subjects.length === 0) || (kind === 'work' && shifts.length === 0)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  timer: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  clock: { fontSize: 72, fontWeight: '200', fontVariant: ['tabular-nums'] },
});
