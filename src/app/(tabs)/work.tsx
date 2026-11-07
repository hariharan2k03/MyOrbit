import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Segmented } from '@/components/form';
import { Card, Divider, EmptyState, Fab, GradientTile, Icon, IconButton, ListRow, ProgressBar, QueryView, Row, Screen, SectionHeader, Stat, Text } from '@/components/ui';
import { listIncome } from '@/database/repositories/finance';
import { listShiftsInRange, listUpcomingShifts, listWorkplaces, type Shift } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { TAX_RESIDENCY_LABEL, TAX_YEAR_LABEL, takeHome, type TaxResidency } from '@/features/finance/auTax';
import { PAY_KIND_LABEL, shiftPay, type PayKind } from '@/features/work/payRates';
import { leadLabel } from '@/features/reminders/planReminders';
import { paidMinutesOf, shiftPhase } from '@/features/work/shiftMath';
import { DEFAULT_SETTINGS } from '@/database/repositories/settings';
import { useApp } from '@/services/AppContext';
import { useQuery } from '@/services/useQuery';
import { radius, spacing, type TileTone } from '@/theme/tokens';
import { formatCents, sumCents } from '@/utils/money';
import { addDays, dateFromKey, eachDay, formatDateKey, fortnightRange, isValidDateKey, formatDuration, formatTimeRange, monthLabel, monthRange, todayKey, weekRange, weekdayShort, type DateKey } from '@/utils/time';

type Tab = 'schedule' | 'hours' | 'salary';

async function loadWork(db: SqlDb, anchor: DateKey, payAnchor: DateKey) {
  const now = Date.now();
  const week = weekRange(anchor);
  const lastWeek = weekRange(addDays(anchor, -7));
  const month = monthRange(anchor);
  const fortnight = fortnightRange(anchor, payAnchor);
  const [weekShifts, lastWeekShifts, monthShifts, fortnightShifts, workplaces, upcoming, monthIncome] = await Promise.all([
    listShiftsInRange(db, week),
    listShiftsInRange(db, lastWeek),
    listShiftsInRange(db, month),
    listShiftsInRange(db, fortnight),
    listWorkplaces(db),
    listUpcomingShifts(db, now, 1),
    listIncome(db, month),
  ]);
  return { now, week, month, fortnight, weekShifts, lastWeekShifts, monthShifts, fortnightShifts, workplaces, next: upcoming[0] ?? null, monthIncome };
}

const active = (shifts: Shift[]) => shifts.filter((s) => s.status !== 'cancelled');
const paid = (shifts: Shift[]) => active(shifts).reduce((m, s) => m + paidMinutesOf(s), 0);
const gross = (shifts: Shift[]) => active(shifts).reduce((c, s) => c + shiftPay(s, s.rates).grossCents, 0);
const hoursLabel = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

/** Gross split by pay type (ordinary, night, Saturday, Sunday) across shifts. */
function grossByKind(shifts: Shift[]) {
  const totals = new Map<PayKind, { minutes: number; cents: number }>();
  for (const s of active(shifts)) {
    for (const seg of shiftPay(s, s.rates).segments) {
      const t = totals.get(seg.kind) ?? { minutes: 0, cents: 0 };
      t.minutes += seg.minutes;
      t.cents += seg.cents;
      totals.set(seg.kind, t);
    }
  }
  return [...totals.entries()].map(([kind, t]) => ({ kind, ...t }));
}

function relativeDay(date: DateKey, today: DateKey) {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return formatDateKey(date, { weekday: true });
}

export default function WorkScreen() {
  const { colors, settings, updateSetting } = useApp();
  const [tab, setTab] = useState<Tab>('schedule');
  const [anchor, setAnchor] = useState(todayKey());
  // Falls back to the default if the setting is missing or malformed, so Salary can never fail to load.
  const payAnchor = isValidDateKey(settings.payFortnightAnchor ?? '') ? settings.payFortnightAnchor : DEFAULT_SETTINGS.payFortnightAnchor;
  const query = useQuery((d) => loadWork(d, anchor, payAnchor), [anchor, payAnchor]);
  const goal = settings.weeklyHoursTarget;

  const editGoal = () =>
    Alert.prompt(
      'Weekly hours goal',
      'Paid hours you aim to work each week. Leave blank or 0 for no goal.',
      (text) => {
        const n = Number((text ?? '').trim() || '0');
        if (!Number.isInteger(n) || n < 0 || n > 80) return Alert.alert('Enter a whole number of hours from 0 to 80.');
        void updateSetting('weeklyHoursTarget', n);
      },
      'plain-text',
      goal ? String(goal) : '',
      'number-pad',
    );

  const chooseResidency = () => {
    const keys = Object.keys(TAX_RESIDENCY_LABEL) as TaxResidency[];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Tax residency', message: 'Used to estimate tax on your pay.', options: [...keys.map((k) => TAX_RESIDENCY_LABEL[k]), 'Cancel'], cancelButtonIndex: keys.length },
      (i) => {
        const k = keys[i];
        if (k) void updateSetting('taxResidency', k);
      },
    );
  };

  return (
    <Screen
      title="Work"
      trailing={
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <GradientTile icon="briefcase.fill" tone="work" size={52} />
        </View>
      }
      onRefresh={() => void query.refresh()}
      refreshing={query.refreshing}
      overlay={<Fab label="Add shift" onPress={() => router.push('/shift/new')} />}
    >
      <Segmented
        options={[
          { value: 'schedule', label: 'Schedule' },
          { value: 'hours', label: 'Hours' },
          { value: 'salary', label: 'Salary' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <QueryView query={query}>
        {(d) => {
          if (d.workplaces.length === 0) {
            return (
              <Card>
                <EmptyState
                  icon="building.2"
                  title="Add your first workplace"
                  message="Workplaces store your base and penalty rates so shifts can estimate your pay."
                  action="Add workplace"
                  onAction={() => router.push('/workplace/new')}
                />
              </Card>
            );
          }
          const today = todayKey();
          const weekMin = paid(d.weekShifts);
          const days = eachDay(d.week).map((date) => ({ date, minutes: paid(d.weekShifts.filter((s) => s.shiftDate === date)) }));
          const weekGross = gross(d.weekShifts);
          const weekNet = takeHome(weekGross, 52, settings.taxResidency);

          const weekNav = (
            <Row>
              <IconButton icon="chevron.left" label="Previous week" onPress={() => setAnchor((a) => addDays(a, -7))} />
              <Text variant="headline" style={{ flex: 1, textAlign: 'center' }}>
                {formatDateKey(d.week.start)} – {formatDateKey(addDays(d.week.end, -1))}
              </Text>
              <IconButton icon="chevron.right" label="Next week" onPress={() => setAnchor((a) => addDays(a, 7))} />
            </Row>
          );

          const thisWeekCard = (
            <Card>
              <Row>
                <Text variant="headline" style={{ flex: 1 }}>
                  {d.week.start <= today && today < d.week.end ? 'This Week' : `Week of ${formatDateKey(d.week.start)}`}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Set weekly hours goal" onPress={editGoal} hitSlop={8}>
                  <Text variant="headline">
                    {hoursLabel(weekMin)}
                    <Text variant="subhead" tone="secondary">
                      {goal ? ` / ${goal}h` : '  Set goal'}
                    </Text>
                  </Text>
                </Pressable>
              </Row>
              <ProgressBar value={goal ? weekMin / (goal * 60) : weekMin > 0 ? 1 : 0} height={8} />
              <View style={styles.dayRow}>
                {days.map((x) => {
                  const isToday = x.date === today;
                  return (
                    <View
                      key={x.date}
                      accessibilityLabel={`${weekdayShort(x.date)} ${dateFromKey(x.date).getDate()}: ${formatDuration(x.minutes)}`}
                      style={[styles.dayTile, { backgroundColor: isToday ? colors.accentSoft : colors.surface, borderColor: isToday ? colors.accent : colors.border }]}
                    >
                      <Text variant="caption" tone={isToday ? 'accent' : 'secondary'}>
                        {weekdayShort(x.date)}
                      </Text>
                      <Text variant="subhead" style={{ fontWeight: '600' }}>
                        {x.minutes ? hoursLabel(x.minutes) : '–'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Card>
          );

          if (tab === 'schedule') {
            const menu: { icon: string; tone: TileTone; title: string; subtitle: string; onPress: () => void }[] = [
              { icon: 'calendar', tone: 'accent', title: 'My Shifts', subtitle: `${active(d.weekShifts).length} this week`, onPress: () => router.push('/shifts' as Href) },
              { icon: 'clock.fill', tone: 'sky', title: 'Working Hours', subtitle: `${formatDuration(weekMin)} this week`, onPress: () => setTab('hours') },
              { icon: 'banknote.fill', tone: 'money', title: 'Salary & Payslips', subtitle: `${formatCents(weekNet.netCents)} est. take-home`, onPress: () => setTab('salary') },
              { icon: 'building.2.fill', tone: 'work', title: 'Workplaces & Pay Rates', subtitle: `${d.workplaces.length} ${d.workplaces.length === 1 ? 'workplace' : 'workplaces'}`, onPress: () => router.push('/workplaces' as Href) },
              {
                icon: 'bell.badge.fill',
                tone: 'expense',
                title: 'Shift Reminders',
                subtitle: settings.notificationsEnabled && settings.shiftReminderMinutes > 0 ? `${leadLabel(settings.shiftReminderMinutes)} before each shift` : 'Off',
                onPress: () => router.push('/reminders' as Href),
              },
            ];
            return (
              <>
                {d.next ? (
                  <Card onPress={() => router.push(`/shift/${d.next!.id}`)} accessibilityLabel="Next shift">
                    <Row>
                      <GradientTile icon="calendar" tone="accent" size={44} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="headline">Next Shift</Text>
                        <Text variant="subhead" tone="secondary">
                          {relativeDay(d.next.shiftDate, today)}, {formatTimeRange(d.next.startAt, d.next.endAt)}
                        </Text>
                        <Text variant="caption" tone="tertiary">
                          {d.next.workplaceName} · {shiftPhase(d.next, d.now) === 'in_progress' ? 'In progress' : 'Upcoming'}
                        </Text>
                      </View>
                      <Icon name="chevron.right" color={colors.textTertiary} size={12} />
                    </Row>
                  </Card>
                ) : (
                  <Card>
                    <Row>
                      <GradientTile icon="calendar" tone="accent" size={44} />
                      <Text variant="subhead" tone="secondary" style={{ flex: 1 }}>
                        No upcoming shifts. Tap + to add one.
                      </Text>
                    </Row>
                  </Card>
                )}
                {thisWeekCard}
                <Card style={{ paddingVertical: spacing.xs }}>
                  {menu.map((m, i) => (
                    <View key={m.title}>
                      {i > 0 ? <Divider /> : null}
                      <ListRow icon={m.icon} tone={m.tone} title={m.title} subtitle={m.subtitle} onPress={m.onPress} />
                    </View>
                  ))}
                </Card>
              </>
            );
          }

          if (tab === 'hours') {
            const lastMin = paid(d.lastWeekShifts);
            return (
              <>
                {weekNav}
                {thisWeekCard}
                <Card>
                  <Row align="start">
                    <Stat label="vs last week" value={lastMin ? `${weekMin >= lastMin ? '+' : '−'}${formatDuration(Math.abs(weekMin - lastMin))}` : '—'} hint={lastMin ? formatDuration(lastMin) : 'No shifts'} />
                    <Stat label={monthLabel(d.month.start)} value={formatDuration(paid(d.monthShifts))} hint="paid hours" />
                  </Row>
                </Card>
                <Card>
                  <SectionHeader title="Shifts" />
                  {d.weekShifts.length === 0 ? (
                    <Text variant="subhead" tone="secondary">
                      No shifts this week.
                    </Text>
                  ) : (
                    active(d.weekShifts).map((s) => (
                      <ListRow
                        key={s.id}
                        icon="briefcase.fill"
                        iconColor={s.workplaceColor}
                        title={`${formatDateKey(s.shiftDate, { weekday: true })} · ${s.workplaceName}`}
                        subtitle={formatTimeRange(s.startAt, s.endAt)}
                        value={formatDuration(paidMinutesOf(s))}
                        onPress={() => router.push(`/shift/${s.id}`)}
                      />
                    ))
                  )}
                </Card>
              </>
            );
          }

          const fortnightGross = gross(d.fortnightShifts);
          const fortnightNet = takeHome(fortnightGross, 26, settings.taxResidency);
          const monthGross = gross(d.monthShifts);
          const monthNet = takeHome(monthGross, 12, settings.taxResidency);
          const linkedIncome = d.monthIncome.filter((i) => i.workplaceId !== null);
          const received = sumCents(linkedIncome.map((i) => i.amountCents));
          const byKind = grossByKind(d.weekShifts);
          return (
            <>
              {weekNav}
              <Card>
                <Text variant="caption" tone="secondary" style={styles.caps}>
                  This week (estimate)
                </Text>
                <Row align="start">
                  <Stat label="You earn" value={formatCents(weekGross)} hint="gross" />
                  <Stat label="After tax" value={formatCents(weekNet.netCents)} tone="success" hint={`${formatCents(weekNet.taxCents)} tax`} />
                </Row>
                {byKind.length > 1 || byKind[0]?.kind !== 'base'
                  ? byKind.map((k) => (
                      <Row key={k.kind}>
                        <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
                          {PAY_KIND_LABEL[k.kind]} · {formatDuration(k.minutes)}
                        </Text>
                        <Text variant="footnote">{formatCents(k.cents)}</Text>
                      </Row>
                    ))
                  : null}
                <Divider />
                <Row>
                  <Text variant="caption" tone="secondary" style={[styles.caps, { flex: 1 }]}>
                    Pay fortnight {formatDateKey(d.fortnight.start)} – {formatDateKey(addDays(d.fortnight.end, -1))}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Shift the pay fortnight by one week"
                    hitSlop={8}
                    onPress={() => void updateSetting('payFortnightAnchor', addDays(payAnchor, 7))}
                  >
                    <Text variant="caption" tone="accent">
                      Shift a week
                    </Text>
                  </Pressable>
                </Row>
                <Row align="start">
                  <Stat label="You earn" value={formatCents(fortnightGross)} hint={`${formatDuration(paid(d.fortnightShifts))} paid`} />
                  <Stat label="After tax" value={formatCents(fortnightNet.netCents)} tone="success" hint={`${formatCents(fortnightNet.taxCents)} tax`} />
                </Row>
                <Divider />
                <Text variant="caption" tone="secondary" style={styles.caps}>
                  {monthLabel(d.month.start)} (estimate)
                </Text>
                <Row align="start">
                  <Stat label="You earn" value={formatCents(monthGross)} hint="gross" />
                  <Stat label="After tax" value={formatCents(monthNet.netCents)} tone="success" hint={`${formatCents(monthNet.taxCents)} tax`} />
                </Row>
              </Card>

              <Card onPress={chooseResidency} accessibilityLabel="Change tax residency">
                <Row>
                  <GradientTile icon="building.columns.fill" tone="accent" size={36} />
                  <View style={{ flex: 1 }}>
                    <Text variant="subhead" style={{ fontWeight: '600' }}>
                      {TAX_RESIDENCY_LABEL[settings.taxResidency]}
                    </Text>
                    <Text variant="caption" tone="secondary">
                      ATO {TAX_YEAR_LABEL} rates{settings.taxResidency.startsWith('resident') ? ' + 2% Medicare levy' : ''} · tap to change
                    </Text>
                  </View>
                  <Icon name="chevron.right" color={colors.textTertiary} size={12} />
                </Row>
                <Text variant="caption" tone="tertiary">
                  Estimated by annualising this period’s pay. Your payslip uses ATO withholding tables and may differ slightly; HELP/STSL, super and deductions aren’t included.
                </Text>
              </Card>

              <Card>
                <SectionHeader title="Payslips" action="Record pay" onAction={() => router.push('/income/new')} />
                <Stat label={`Received in ${monthLabel(d.month.start)}`} value={formatCents(received)} tone="success" />
                {linkedIncome.length === 0 ? (
                  <Text variant="subhead" tone="secondary">
                    No pay recorded for a workplace this month. Use “Record pay” and pick the workplace.
                  </Text>
                ) : (
                  linkedIncome.map((i) => (
                    <ListRow
                      key={i.id}
                      icon="banknote.fill"
                      iconColor={d.workplaces.find((w) => w.id === i.workplaceId)?.color}
                      title={i.source}
                      subtitle={`Paid ${formatDateKey(i.payDate)}`}
                      value={formatCents(i.amountCents)}
                      valueTone="success"
                      onPress={() => router.push(`/income/${i.id}`)}
                    />
                  ))
                )}
              </Card>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  caps: { textTransform: 'uppercase', letterSpacing: 0.5 },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayTile: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
});
