import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Segmented } from '@/components/form';
import { Card, Divider, EmptyState, ListRow, QueryView, Row, Screen, Stat, Text } from '@/components/ui';
import { listShiftsInRange, type Shift } from '@/database/repositories/work';
import { clockedDifference, worked } from '@/features/work/clock';
import { shiftPay } from '@/features/work/payRates';
import { paidMinutesOf } from '@/features/work/shiftMath';
import { useApp } from '@/services/AppContext';
import { useQuery } from '@/services/useQuery';
import { formatCents } from '@/utils/money';
import { addDays, addMonths, formatClock, formatDateKey, formatDuration, formatTimeRange, monthLabel, monthRange, todayKey, weekRange, type DateRange } from '@/utils/time';

type Period = 'week' | 'lastWeek' | 'month' | 'lastMonth';

function rangeFor(p: Period): DateRange {
  const today = todayKey();
  if (p === 'week') return weekRange(today);
  if (p === 'lastWeek') return weekRange(addDays(today, -7));
  if (p === 'month') return monthRange(today);
  return monthRange(addMonths(today, -1));
}

function recordLine(s: Shift, now: number): { subtitle: string; tone?: 'warning' | 'success' } {
  if (s.status === 'cancelled') return { subtitle: `Cancelled · was ${formatTimeRange(s.startAt, s.endAt)}` };
  if (s.clockInAt !== null && s.clockOutAt !== null) {
    const diff = clockedDifference(s) ?? 0;
    const vs = diff === 0 ? 'as rostered' : `${diff > 0 ? '+' : '−'}${formatDuration(Math.abs(diff))} vs roster`;
    return { subtitle: `In ${formatClock(s.clockInAt)} · Out ${formatClock(s.clockOutAt)} · ${vs}`, tone: 'success' };
  }
  if (s.clockInAt !== null) return { subtitle: `In ${formatClock(s.clockInAt)} · still clocked in`, tone: 'warning' };
  if (s.endAt <= now && s.status === 'scheduled') return { subtitle: `Rostered ${formatTimeRange(s.startAt, s.endAt)} · not clocked in`, tone: 'warning' };
  if (s.status === 'completed') return { subtitle: `Rostered ${formatTimeRange(s.startAt, s.endAt)} · marked completed` };
  return { subtitle: `Upcoming · ${formatTimeRange(s.startAt, s.endAt)}` };
}

/** Clock-in/out history: what you actually worked, compared with the roster. */
export default function WorkRecordsScreen() {
  const { colors } = useApp();
  const [period, setPeriod] = useState<Period>('week');
  const range = rangeFor(period);
  const query = useQuery(async (db) => ({ shifts: await listShiftsInRange(db, range), now: Date.now() }), [range.start, range.end]);

  return (
    <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing}>
      <Segmented
        options={[
          { value: 'week', label: 'This Week' },
          { value: 'lastWeek', label: 'Last Week' },
          { value: 'month', label: 'This Month' },
          { value: 'lastMonth', label: 'Last Month' },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <QueryView query={query}>
        {({ shifts, now }) => {
          const active = shifts.filter((s) => s.status !== 'cancelled');
          // Hours and pay so far: finished or clocked-out shifts only.
          const done = active.filter((s) => s.clockOutAt !== null || s.status === 'completed' || s.endAt <= now);
          const minutes = done.reduce((m, s) => m + paidMinutesOf(worked(s)), 0);
          const gross = done.reduce((c, s) => c + shiftPay(worked(s), s.rates).grossCents, 0);
          const clocked = done.filter((s) => s.clockOutAt !== null).length;
          const title = period === 'month' || period === 'lastMonth' ? monthLabel(range.start) : `${formatDateKey(range.start)} – ${formatDateKey(addDays(range.end, -1))}`;
          return (
            <>
              <Card>
                <Text variant="caption" tone="secondary" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {title}
                </Text>
                <Row align="start">
                  <Stat label="Total hours" value={formatDuration(minutes)} hint={`${done.length} ${done.length === 1 ? 'shift' : 'shifts'} worked`} />
                  <Stat label="Earnings (est.)" value={formatCents(gross)} tone="success" hint="gross, before tax" />
                </Row>
                <Text variant="footnote" tone="tertiary">
                  {clocked === done.length ? 'All from your clock-in and clock-out times.' : `${clocked} of ${done.length} from clocked times; the rest use rostered times.`}
                </Text>
              </Card>
              <Card style={{ paddingVertical: shifts.length ? 4 : undefined }}>
                {shifts.length === 0 ? (
                  <EmptyState icon="list.clipboard" title="No shifts" message="Shifts and your clock-in times show here." />
                ) : (
                  shifts.map((s, i) => {
                    const line = recordLine(s, now);
                    const finished = s.clockOutAt !== null || s.status === 'completed' || s.endAt <= now;
                    return (
                      <View key={s.id}>
                        {i > 0 ? <Divider /> : null}
                        <ListRow
                          icon={s.clockOutAt !== null ? 'checkmark.circle.fill' : s.clockInAt !== null ? 'clock.fill' : 'calendar'}
                          iconColor={s.status === 'cancelled' ? colors.textTertiary : line.tone === 'warning' ? colors.warning : s.workplaceColor}
                          title={`${formatDateKey(s.shiftDate, { weekday: true })} · ${s.workplaceName}${s.changedAt ? ' · Changed' : ''}`}
                          subtitle={line.subtitle}
                          value={s.status === 'cancelled' || !finished ? undefined : formatDuration(paidMinutesOf(worked(s)))}
                          strike={s.status === 'cancelled'}
                          onPress={() => router.push(`/shift/${s.id}`)}
                        />
                      </View>
                    );
                  })
                )}
              </Card>
              <Text variant="footnote" tone="tertiary">
                Tap a shift to correct its clock-in or clock-out time.
              </Text>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
