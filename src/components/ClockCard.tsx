import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, StyleSheet, View } from 'react-native';
import { Button, Card, GradientTile, Icon, Row, Tag, Text } from '@/components/ui';
import type { Shift } from '@/database/repositories/work';
import { clockOpensAt, clockOutOpensAt, clockState, formatElapsed } from '@/features/work/clock';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { clockInNow, clockOutNow } from '@/services/shiftClock';
import { spacing } from '@/theme/tokens';
import { addDays, formatClock, formatDateKey, formatTimeRange, MINUTE_MS, todayKey } from '@/utils/time';

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
    const t = setInterval(() => setNow(currentTime()), working ? 1000 : 15_000);
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

  const run = async (fn: () => Promise<unknown>, failTitle: string) => {
    setBusy(true);
    try {
      await fn();
      haptic('success');
      notifyDataChanged('all');
    } catch (e) {
      haptic('error');
      Alert.alert(failTitle, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setNow(currentTime());
    }
  };

  const clockIn = () => void run(() => clockInNow(db, shift.id, rules), 'Couldn’t clock in');

  const clockOut = () => {
    const t = currentTime();
    if (t - shift.endAt < LATE_CLOCK_OUT_MS) {
      void run(() => clockOutNow(db, shift.id, rules, t), 'Couldn’t clock out');
      return;
    }
    // Forgot to clock out: let them record the rostered finish instead of now.
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'When did you finish?',
        message: `Your shift was rostered to finish at ${formatClock(shift.endAt)}.`,
        options: [`At ${formatClock(shift.endAt)} (rostered)`, `Now (${formatClock(t)})`, 'Cancel'],
        cancelButtonIndex: 2,
      },
      (i) => {
        if (i === 0) void run(() => clockOutNow(db, shift.id, rules, shift.endAt, t), 'Couldn’t clock out');
        if (i === 1) void run(() => clockOutNow(db, shift.id, rules, t, t), 'Couldn’t clock out');
      },
    );
  };

  const changed = shift.changedAt !== null && shift.previousStartAt !== null && shift.previousEndAt !== null;
  const inOpens = clockOpensAt(shift, rules);
  const outOpens = clockOutOpensAt(shift, rules);

  let hint: { icon: string; text: string; tone?: 'warning' | 'success' }[] = [];
  if (state.kind === 'not_yet') {
    hint = [
      { icon: 'clock', text: `Clock in opens at ${formatClock(inOpens)} (${untilLabel(inOpens - now)})` },
      { icon: 'clock', text: `Clock out opens at ${formatClock(outOpens)}` },
    ];
  } else if (state.kind === 'can_clock_in') {
    hint = [
      state.late ? { icon: 'exclamationmark.circle', text: `Started at ${formatClock(shift.startAt)} — clock in now`, tone: 'warning' } : { icon: 'checkmark.circle', text: 'Clock in is open', tone: 'success' },
      { icon: 'clock', text: `Clock out opens at ${formatClock(outOpens)}` },
    ];
  } else if (state.kind === 'working') {
    hint = [
      state.overtime
        ? { icon: 'exclamationmark.circle', text: `Rostered finish was ${formatClock(shift.endAt)} — remember to clock out`, tone: 'warning' }
        : state.canClockOut
          ? { icon: 'checkmark.circle', text: 'Clock out is open', tone: 'success' }
          : { icon: 'clock', text: `Clock out opens at ${formatClock(state.clockOutOpensAt)} (${untilLabel(state.clockOutOpensAt - now)})` },
    ];
  }

  return (
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
        <View style={styles.timer} accessible accessibilityLabel={`Clocked in at ${formatClock(state.clockedInAt)}`}>
          <Text style={[styles.elapsed, { color: colors.success }]}>{formatElapsed(now - state.clockedInAt)}</Text>
          <Text variant="footnote" tone="secondary">
            Since {formatClock(state.clockedInAt)}
          </Text>
        </View>
      ) : null}

      {state.kind === 'missed' ? (
        <>
          <Text variant="subhead" tone="warning">
            This shift finished without a clock-in.
          </Text>
          <Button title="Add worked times" kind="secondary" icon="pencil" onPress={() => router.push(`/shift/${shift.id}`)} />
        </>
      ) : (
        <View style={styles.buttons}>
          <Button
            title="Clock In"
            icon="arrow.right.to.line"
            kind={state.kind === 'can_clock_in' ? 'primary' : 'secondary'}
            disabled={state.kind !== 'can_clock_in'}
            loading={busy && state.kind === 'can_clock_in'}
            onPress={clockIn}
            style={{ flex: 1 }}
          />
          <Button
            title="Clock Out"
            icon="arrow.left.to.line"
            kind={state.kind === 'working' && state.canClockOut ? 'primary' : 'secondary'}
            disabled={!(state.kind === 'working' && state.canClockOut)}
            loading={busy && state.kind === 'working'}
            onPress={clockOut}
            style={{ flex: 1 }}
          />
        </View>
      )}

      {hint.map((h) => (
        <Row key={h.text}>
          <Icon name={h.icon} size={14} color={h.tone ? colors[h.tone] : colors.textTertiary} />
          <Text variant="footnote" tone={h.tone ?? 'secondary'} style={{ flex: 1 }}>
            {h.text}
          </Text>
        </Row>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  timer: { alignItems: 'center', gap: 2, paddingVertical: spacing.xs },
  elapsed: { fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: 1 },
});
