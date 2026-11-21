import { router, type Href } from 'expo-router';
import { worked } from '@/features/work/clock';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Segmented } from '@/components/form';
import { Card, Divider, EmptyState, Fab, GradientTile, Icon, IconButton, ListRow, ProgressBar, QueryView, Row, Screen, SectionHeader, Stat, Text } from '@/components/ui';
import { listIncome } from '@/database/repositories/finance';
import { ClockCard } from '@/components/ClockCard';
import { getClockShift, listShiftsInRange, listWorkplaces, type Shift } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { TAX_RESIDENCY_LABEL, TAX_YEAR_LABEL, takeHome, type TaxResidency } from '@/features/finance/auTax';
import { PAY_KIND_LABEL, shiftPay, type PayKind } from '@/features/work/payRates';
import { leadLabel } from '@/features/reminders/planReminders';
import { paidMinutesOf } from '@/features/work/shiftMath';
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
  const month = monthRange(anchor);
  const fortnight = fortnightRange(anchor, payAnchor);
  const lastFortnight = fortnightRange(addDays(fortnight.start, -14), payAnchor);
  const [weekShifts, lastFortnightShifts, monthShifts, fortnightShifts, workplaces, clockShift, monthIncome] = await Promise.all([
    listShiftsInRange(db, week),
    listShiftsInRange(db, lastFortnight),
    listShiftsInRange(db, month),
    listShiftsInRange(db, fortnight),
    listWorkplaces(db),
    getClockShift(db, now),
    listIncome(db, month),
  ]);
  return { now, week, month, fortnight, weekShifts, lastFortnightShifts, monthShifts, fortnightShifts, workplaces, clockShift, monthIncome };
}

const active = (shifts: Shift[]) => shifts.filter((s) => s.status !== 'cancelled');
const paid = (shifts: Shift[]) => active(shifts).reduce((m, s) => m + paidMinutesOf(worked(s)), 0);
const gross = (shifts: Shift[]) => active(shifts).reduce((c, s) => c + shiftPay(worked(s), s.rates).grossCents, 0);
const hoursLabel = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

/** Gross split by pay type (ordinary, night, Saturday, Sunday) across shifts. */
function grossByKind(shifts: Shift[]) {
  const totals = new Map<PayKind, { minutes: number; cents: number }>();
  for (const s of active(shifts)) {
    for (const seg of shiftPay(worked(s), s.rates).segments) {
      const t = totals.get(seg.kind) ?? { minutes: 0, cents: 0 };
      t.minutes += seg.minutes;
      t.cents += seg.cents;
      totals.set(seg.kind, t);
    }
  }
  return [...totals.entries()].map(([kind, t]) => ({ kind, ...t }));
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
      trailing={<IconButton icon="gearshape" label="Clock & Roster settings" onPress={() => router.push('/work-settings' as Href)} />}
      onRefresh={() => void query.refresh()}
      refreshing={query.refreshing}
      overlay={<Fab label="Add shift" onPress={() => router.push('/shift/new')} />}
    >
      <Segmented
        options={[
          { value: 'schedule', label: 'Overview' },
          { value: 'hours', label: 'Shifts' },
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
              { icon: 'list.clipboard.fill', tone: 'work', title: 'Work Records', subtitle: `${formatDuration(weekMin)} this week · clock in/out history`, onPress: () => router.push('/work-records' as Href) },
              { icon: 'building.2.fill', tone: 'work', title: 'Workplaces & Pay Rates', subtitle: `${d.workplaces.length} ${d.workplaces.length === 1 ? 'workplace' : 'workplaces'}`, onPress: () => router.push('/workplaces' as Href) },
              {
                icon: 'bell.badge.fill',
                tone: 'expense',
                title: 'Shift Reminders',
                subtitle: settings.notificationsEnabled && settings.shiftReminderMinutes > 0 ? `${leadLabel(settings.shiftReminderMinutes)} before each shift` : 'Off',
                onPress: () => router.push('/reminders' as Href),
              },
              {
                icon: 'gearshape.fill',
                tone: 'accent',
                title: 'Clock & Roster',
                subtitle: `Clock in ${settings.clockInEarlyMinutes} min early · out ${settings.clockOutEarlyMinutes} min early${settings.appLockEnabled ? ' · Face ID on' : ''}`,
                onPress: () => router.push('/work-settings' as Href),
              },
            ];
            const fnActive = active(d.fortnightShifts);
            const tiles: { icon: string; color: string; label: string; value: string; onPress: () => void }[] = [
              { icon: 'calendar', color: colors.accent, label: 'This Week', value: `${(weekMin / 60).toFixed(1)} hrs`, onPress: () => setTab('hours') },
              { icon: 'chart.bar.fill', color: colors.accent, label: 'This Fortnight', value: `${(paid(d.fortnightShifts) / 60).toFixed(1)} hrs`, onPress: () => setTab('hours') },
              { icon: 'square.stack.3d.up.fill', color: colors.accent, label: 'Shifts', value: `${fnActive.length}`, onPress: () => router.push('/shifts' as Href) },
              { icon: 'dollarsign.circle.fill', color: colors.warning, label: 'Earnings (Est.)', value: formatCents(gross(d.fortnightShifts)), onPress: () => setTab('salary') },
            ];
            return (
              <>
                <ClockCard shift={d.clockShift} />
                {thisWeekCard}
                <View style={styles.tiles}>
                  {tiles.map((t) => (
                    <Pressable
                      key={t.label}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.label}: ${t.value}`}
                      onPress={t.onPress}
                      style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Icon name={t.icon} color={t.color} size={26} />
                      <View style={{ flex: 1 }}>
                        <Text variant="footnote" tone="secondary" numberOfLines={1}>
                          {t.label}
                        </Text>
                        <Text variant="headline" numberOfLines={1} adjustsFontSizeToFit>
                          {t.value}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
                <Card onPress={() => router.push('/roster-import' as Href)} accessibilityLabel="Upload Roster">
                  <Row>
                    <GradientTile icon="doc.text.viewfinder" tone="sky" size={44} />
                    <View style={{ flex: 1 }}>
                      <Text variant="headline">Upload Roster</Text>
                      <Text variant="footnote" tone="secondary">
                        Scan or select roster image — only your shifts
                      </Text>
                    </View>
                    <Icon name="chevron.right" color={colors.textTertiary} size={12} />
                  </Row>
                </Card>
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
            // Pay-fortnight comparison (same fortnights as Salary).
            const fortnightMin = paid(d.fortnightShifts);
            const lastMin = paid(d.lastFortnightShifts);
            return (
              <>
                {weekNav}
                {thisWeekCard}
                <Card>
                  <Row align="start">
                    <Stat
                      label={`Fortnight ${formatDateKey(d.fortnight.start)} – ${formatDateKey(addDays(d.fortnight.end, -1))}`}
                      value={formatDuration(fortnightMin)}
                      hint="paid hours"
                    />
                    <Stat
                      label="vs last fortnight"
                      value={lastMin ? `${fortnightMin >= lastMin ? '+' : '−'}${formatDuration(Math.abs(fortnightMin - lastMin))}` : '—'}
                      hint={lastMin ? `${formatDuration(lastMin)} last fortnight` : 'No shifts'}
                    />
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
                        value={formatDuration(paidMinutesOf(worked(s)))}
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
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  caps: { textTransform: 'uppercase', letterSpacing: 0.5 },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayTile: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
});
