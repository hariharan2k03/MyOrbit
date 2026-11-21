import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, Card, GradientTile, Icon, Row, Tag, Text } from '@/components/ui';
import { setWorkedTimes, type Shift } from '@/database/repositories/work';
import { clockOpensAt, clockOutOpensAt, clockState } from '@/features/work/clock';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { clockInNow, clockOutNow } from '@/services/shiftClock';
import { spacing } from '@/theme/tokens';
import { addDays, formatClock, formatDateKey, formatDuration, formatTimeRange, MINUTE_MS, todayKey } from '@/utils/time';

/** "in 25 min" / "in 2h 5m" for an upcoming moment. */
function untilLabel(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / MINUTE_MS));
  if (mins < 60) return `in ${mins} min`;
  if (mins >= 24 * 60) {
    const days = Math.round(mins / (24 * 60));
    return days === 1 ? 'tomorrow' : `in ${days} days`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

function dayLabel(date: string): string {
  const today = todayKey();
  if (date === today) return 'Today’s Shift';
  if (date === addDays(today, 1)) return 'Tomorrow’s Shift';
  return `Next Shift · ${formatDateKey(date, { weekday: true })}`;
}

/** Read the clock outside render; event handlers and timers call this. */
const currentTime = () => Date.now();

/** If you clock out this long after the rostered finish, you're asked which time to record. */
const LATE_CLOCK_OUT_MS = 15 * MINUTE_MS;

/**
 * Today's (or the next) shift with Clock In / Clock Out. The buttons unlock at
 * the times set in Clock & Roster settings; while you're working a live timer
 * runs, and the same countdown shows in the Dynamic Island.
 */
export function ClockCard({ shift }: { shift: Shift | null }) {
  const { db, colors, settings, notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const [now, setNow] = useState(currentTime);
  const [busy, setBusy] = useState(false);
  const rules = { clockInEarlyMinutes: settings.clockInEarlyMinutes, clockOutEarlyMinutes: settings.clockOutEarlyMinutes };
  const state = shift ? clockState(shift, now, rules) : null;

  // Every second while working (the timer); otherwise often enough to unlock a button on time.
  const working = state?.kind === 'working';
  useEffect(() => {
    // Once a minute is enough: worked time is shown in minutes, not a ticking clock.
    const t = setInterval(() => setNow(currentTime()), working ? 60_000 : 15_000);
    return () => clearInterval(t);
  }, [working]);

  if (!shift || !state) {
    return (
      <Card>
        <Row>
          <GradientTile icon="calendar" tone="accent" size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">No upcoming shifts</Text>
            <Text variant="subhead" tone="secondary">
              Upload your roster or tap + to add a shift.
            </Text>
          </View>
        </Row>
      </Card>
    );
  }

  /** Runs a clock action; resolves true if it was saved. */
  const run = async (fn: () => Promise<unknown>, failTitle: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      haptic('success');
      notifyDataChanged('all');
      return true;
    } catch (e) {
      haptic('error');
      Alert.alert(failTitle, e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
      setNow(currentTime());
    }
  };

  const clockIn = () => {
    if (state.kind === 'not_yet') {
      // A locked button that ignores taps looks broken, so say when it opens.
      Alert.alert('Clock in isn’t open yet', `You can clock in from ${formatClock(state.opensAt)} (${untilLabel(state.opensAt - currentTime())}).`);
      return;
    }
    void run(() => clockInNow(db, shift.id, rules), 'Couldn’t clock in');
  };

  const clockOut = () => {
    const t = currentTime();
    if (state.kind === 'working' && !state.canClockOut) {
      Alert.alert(
        'Leaving early?',
        `Clock out opens at ${formatClock(state.clockOutOpensAt)}, ${rules.clockOutEarlyMinutes} min before your shift ends at ${formatClock(shift.endAt)}.`,
        [
          { text: 'Not yet', style: 'cancel' },
          { text: `Clock out now (${formatClock(t)})`, onPress: () => void run(() => clockOutNow(db, shift.id, rules, t, t, true), 'Couldn’t clock out') },
        ],
      );
      return;
    }
    if (t - shift.endAt < LATE_CLOCK_OUT_MS) {
      void run(() => clockOutNow(db, shift.id, rules, t), 'Couldn’t clock out');
      return;
    }
    // Clocking out late (the usual case): save right away at the real time, so
    // nothing is lost if a prompt is dismissed — then offer the rostered finish.
    const clockedInAt = state.kind === 'working' ? state.clockedInAt : null;
    void run(() => clockOutNow(db, shift.id, rules, t, t), 'Couldn’t clock out').then((saved) => {
      if (!saved || clockedInAt === null) return;
      Alert.alert(`Clocked out at ${formatClock(t)}`, `Your shift was rostered to finish at ${formatClock(shift.endAt)}.`, [
        { text: 'Keep ' + formatClock(t), style: 'cancel' },
        {
          text: `Use ${formatClock(shift.endAt)} (rostered)`,
          onPress: () => void run(() => setWorkedTimes(db, shift.id, clockedInAt, Math.max(shift.endAt, clockedInAt + MINUTE_MS)), 'Couldn’t change the finish time'),
        },
      ]);
    });
  };

  const changed = shift.changedAt !== null && shift.previousStartAt !== null && shift.previousEndAt !== null;
  const inOpens = clockOpensAt(shift, rules);
  const outOpens = clockOutOpensAt(shift, rules);

  let hint: { icon: string; text: string; tone?: 'warning' | 'success' }[] = [];
  if (state.kind === 'not_yet') {
    hint = [
      { icon: 'clock', text: `Clock in available at ${formatClock(inOpens)} (${untilLabel(inOpens - now)})` },
      { icon: 'clock', text: `Clock out available at ${formatClock(outOpens)}` },
    ];
  } else if (state.kind === 'can_clock_in') {
    hint = [
      state.late
        ? { icon: 'exclamationmark.circle', text: `Started at ${formatClock(shift.startAt)} — clock in now`, tone: 'warning' }
        : { icon: 'checkmark.circle', text: 'Clock in is open', tone: 'success' },
      { icon: 'clock', text: `Clock out available at ${formatClock(outOpens)}` },
    ];
  } else if (state.kind === 'working') {
    hint = [
      state.overtime
        ? { icon: 'exclamationmark.circle', text: `Rostered finish was ${formatClock(shift.endAt)} — remember to clock out`, tone: 'warning' }
        : state.canClockOut
          ? { icon: 'checkmark.circle', text: 'Clock out is open', tone: 'success' }
          : { icon: 'clock', text: `Clock out available at ${formatClock(state.clockOutOpensAt)} (${untilLabel(state.clockOutOpensAt - now)})` },
    ];
  }

  return (
    <>
      <Card onPress={() => router.push(`/shift/${shift.id}`)} accessibilityLabel={`${dayLabel(shift.shiftDate)}, ${formatTimeRange(shift.startAt, shift.endAt)}`}>
        <Row align="start">
          <GradientTile icon={working ? 'briefcase.fill' : 'calendar'} tone={working ? 'work' : 'accent'} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="subhead" tone="secondary">
              {working ? 'Shift in progress' : dayLabel(shift.shiftDate)}
            </Text>
            <Text variant="title">{formatTimeRange(shift.startAt, shift.endAt)}</Text>
            <Row>
              <View style={[styles.dot, { backgroundColor: shift.workplaceColor }]} />
              <Text variant="subhead" tone="secondary">
                {shift.workplaceName}
              </Text>
            </Row>
          </View>
          {changed ? <Tag label="Changed" color={colors.warning} /> : null}
        </Row>

        {changed ? (
          <Text variant="footnote" tone="warning">
            Roster changed · was {formatTimeRange(shift.previousStartAt!, shift.previousEndAt!)}
          </Text>
        ) : null}

        {state.kind === 'working' ? (
          <Row gap={spacing.sm}>
            <Icon name="checkmark.circle.fill" color={colors.success} size={16} />
            <Text variant="subhead" style={{ flex: 1 }}>
              Clocked in at {formatClock(state.clockedInAt)} · <Text variant="subhead" tone="success">{formatDuration(Math.max(0, Math.floor((now - state.clockedInAt) / MINUTE_MS)))} worked</Text>
            </Text>
          </Row>
        ) : null}

        {state.kind === 'missed' ? (
          <>
            <Text variant="subhead" tone="warning">
              This shift finished without a clock-in.
            </Text>
            <Button title="Add worked times" kind="secondary" icon="pencil" onPress={() => router.push(`/shift/${shift.id}`)} />
          </>
        ) : null}
      </Card>

      {state.kind === 'missed' ? null : (
        <View style={styles.buttons}>
          <Button
            title="Clock In"
            icon="arrow.right.to.line"
            kind={state.kind === 'can_clock_in' ? 'primary' : 'secondary'}
            // Still tappable before it opens, to explain when it does.
            disabled={state.kind !== 'can_clock_in' && state.kind !== 'not_yet'}
            style={{ flex: 1, opacity: state.kind === 'can_clock_in' ? 1 : 0.55 }}
            loading={busy && state.kind === 'can_clock_in'}
            onPress={clockIn}
          />
          <Button
            title="Clock Out"
            icon="arrow.left.to.line"
            kind={state.kind === 'working' && state.canClockOut ? 'primary' : 'secondary'}
            // While working it's always tappable: early taps ask before clocking out.
            disabled={state.kind !== 'working'}
            loading={busy && state.kind === 'working'}
            onPress={clockOut}
            style={{ flex: 1, opacity: state.kind === 'working' && state.canClockOut ? 1 : 0.55 }}
          />
        </View>
      )}

      {hint.length ? (
        <View style={styles.hints}>
          {hint.map((h) => (
            <Row key={h.text} gap={spacing.sm}>
              <Icon name={h.icon} size={15} color={h.tone ? colors[h.tone] : colors.textSecondary} />
              <Text variant="subhead" tone={h.tone ?? 'secondary'} style={{ flex: 1 }}>
                {h.text}
              </Text>
            </Row>
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttons: { flexDirection: 'row', gap: spacing.md },
  hints: { gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: -spacing.xs },
});
