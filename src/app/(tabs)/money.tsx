import { router } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Pressable, StyleSheet, View } from 'react-native';
import { Segmented } from '@/components/form';
import { Card, Donut, EmptyState, Fab, GradientTile, Icon, IconButton, ListRow, ProgressBar, QueryView, Row, Screen, SectionHeader, Text } from '@/components/ui';
import {
  dailyExpenseTotals,
  expenseTotalsByCategory,
  listBudgets,
  listExpenses,
  listIncome,
  totalExpenses,
  totalIncome,
} from '@/database/repositories/finance';
import type { SqlDb } from '@/database/types';
import { budgetStatus, savingsFor, type BudgetLevel } from '@/features/finance/budgetMath';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { useQuery } from '@/services/useQuery';
import { radius, spacing, type TileTone } from '@/theme/tokens';
import { formatCents } from '@/utils/money';
import {
  addDays,
  addMonths,
  customMonthRange,
  eachDay,
  formatDateKey,
  monthLabel,
  monthRange,
  todayKey,
  weekRange,
  weekdayShort,
  type DateKey,
  type DateRange,
} from '@/utils/time';

type Period = 'week' | 'month';

async function loadMoney(db: SqlDb, period: Period, anchor: DateKey) {
  const range = period === 'week' ? weekRange(anchor) : monthRange(anchor);
  const prev = period === 'week' ? weekRange(addDays(anchor, -7)) : monthRange(addMonths(anchor, -1));
  const budgets = await listBudgets(db);
  const overall = budgets.find((b) => b.categoryId === null);
  const budgetRange = overall ? customMonthRange(anchor, overall.periodStartDay) : monthRange(anchor);
  const [income, spent, prevIncome, prevSpent, byCategory, daily, recent, incomeList, budgetCats, budgetSpent] = await Promise.all([
    totalIncome(db, range),
    totalExpenses(db, range),
    totalIncome(db, prev),
    totalExpenses(db, prev),
    expenseTotalsByCategory(db, range),
    dailyExpenseTotals(db, range),
    listExpenses(db, { range, limit: 8 }),
    listIncome(db, range),
    expenseTotalsByCategory(db, budgetRange),
    totalExpenses(db, budgetRange),
  ]);
  return { range, budgetRange, income, spent, prevIncome, prevSpent, byCategory, daily, recent, incomeList, budgets, budgetCats, budgetSpent, overall };
}

type MoneyData = Awaited<ReturnType<typeof loadMoney>>;

function openAdd() {
  ActionSheetIOS.showActionSheetWithOptions({ title: 'Add', options: ['Expense', 'Income', 'Cancel'], cancelButtonIndex: 2 }, (i) => {
    if (i === 0) router.push('/expense/new');
    if (i === 1) router.push('/income/new');
  });
}

export default function FinanceScreen() {
  const { colors } = useApp();
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(todayKey());
  // Hides amounts on screen (e.g. on public transport). Not persisted on purpose.
  const [hidden, setHidden] = useState(false);
  const query = useQuery((db) => loadMoney(db, period, anchor), [period, anchor]);
  const move = (dir: 1 | -1) => setAnchor((a) => (period === 'week' ? addDays(a, 7 * dir) : addMonths(a, dir)));
  const money = (cents: number, showCents = true) => formatCents(cents, { masked: hidden, showCents });

  return (
    <Screen title="Finance" onRefresh={() => void query.refresh()} refreshing={query.refreshing} overlay={<Fab label="Add transaction" onPress={openAdd} />}>
      <Segmented
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <QueryView query={query}>
        {(d) => {
          const savings = savingsFor({ incomeCents: d.income, expenseCents: d.spent });
          const prevSavings = savingsFor({ incomeCents: d.prevIncome, expenseCents: d.prevSpent });
          const change = savings - prevSavings;
          const label = period === 'week' ? `${formatDateKey(d.range.start)} – ${formatDateKey(addDays(d.range.end, -1))}` : monthLabel(d.range.start);
          return (
            <>
              <Row>
                <IconButton icon="chevron.left" label="Previous period" onPress={() => move(-1)} />
                <Text variant="headline" style={{ flex: 1, textAlign: 'center' }}>
                  {label}
                </Text>
                <IconButton icon="chevron.right" label="Next period" onPress={() => move(1)} />
              </Row>

              <Card>
                <Row>
                  <Text variant="subhead" tone="secondary" style={{ flex: 1 }}>
                    Net {period === 'week' ? 'this week' : 'this month'}
                  </Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show amounts' : 'Hide amounts'} hitSlop={10} onPress={() => setHidden((h) => !h)}>
                    <Icon name={hidden ? 'eye.slash' : 'eye'} color={colors.textSecondary} size={18} />
                  </Pressable>
                </Row>
                <Text style={styles.balance} color={savings < 0 ? colors.danger : colors.text}>
                  {savings < 0 && !hidden ? '-' : ''}
                  {money(Math.abs(savings))}
                </Text>
                {d.prevIncome || d.prevSpent ? (
                  <Row gap={6}>
                    <Icon name={change >= 0 ? 'arrow.up' : 'arrow.down'} color={change >= 0 ? colors.success : colors.danger} size={12} />
                    <Text variant="footnote" tone={change >= 0 ? 'success' : 'danger'}>
                      {money(Math.abs(change))} {change >= 0 ? 'better' : 'worse'} than last {period}
                    </Text>
                  </Row>
                ) : (
                  <Text variant="footnote" tone="tertiary">
                    Income minus expenses.
                  </Text>
                )}
              </Card>

              <View style={styles.actions}>
                <ActionTile icon="plus" tone="money" label="Add Income" onPress={() => router.push('/income/new')} />
                <ActionTile icon="minus" tone="expense" label="Add Expense" onPress={() => router.push('/expense/new')} />
                <ActionTile icon="chart.pie.fill" tone="accent" label="Budgets" onPress={() => router.push('/budget/overall')} />
              </View>

              <Card>
                <SectionHeader title={period === 'week' ? 'This Week' : 'This Month'} />
                <Row>
                  <View style={{ flex: 1, gap: spacing.sm }}>
                    <LegendRow color={colors.success} label="Income" value={money(d.income)} />
                    <LegendRow color={colors.danger} label="Expenses" value={money(d.spent)} />
                    <LegendRow color={colors.warning} label={savings >= 0 ? 'Savings' : 'Shortfall'} value={money(Math.abs(savings))} />
                  </View>
                  <Donut
                    size={104}
                    stroke={12}
                    segments={[
                      { value: d.spent, color: colors.danger },
                      { value: Math.max(0, savings), color: colors.warning },
                    ]}
                  >
                    {/* Share of income spent when there is income; otherwise the amount spent. */}
                    <Text variant="headline" adjustsFontSizeToFit numberOfLines={1} style={{ maxWidth: 76 }}>
                      {d.income > 0 ? `${Math.round((d.spent / d.income) * 100)}%` : money(d.spent, false)}
                    </Text>
                    <Text variant="caption" tone="tertiary">
                      {d.income > 0 ? 'of income' : 'spent'}
                    </Text>
                  </Donut>
                </Row>
              </Card>

              <BudgetCard data={d} money={money} />

              <Card>
                <SectionHeader title="Spending trend" />
                <DailyChart range={d.range} daily={d.daily} period={period} />
              </Card>

              <Card>
                <SectionHeader title="By category" />
                {d.spent === 0 ? (
                  <Text variant="subhead" tone="secondary">
                    No spending this {period}.
                  </Text>
                ) : (
                  d.byCategory
                    .filter((c) => c.totalCents > 0)
                    .map((c) => (
                      <View key={c.categoryId} style={{ gap: 4 }}>
                        <Row>
                          <Text variant="subhead" style={{ flex: 1 }}>
                            {c.name}
                          </Text>
                          <Text variant="subhead" style={{ fontVariant: ['tabular-nums'] }}>
                            {money(c.totalCents)}
                          </Text>
                        </Row>
                        <ProgressBar value={c.totalCents / d.spent} color={c.color} height={6} />
                      </View>
                    ))
                )}
              </Card>

              <Card>
                <SectionHeader title="Recent expenses" action="See all" onAction={() => router.push('/transactions')} />
                {d.recent.length === 0 ? (
                  <EmptyState
                    icon="creditcard"
                    title="No expenses yet"
                    message="Track what you spend to see where your money goes."
                    action="Add expense"
                    onAction={() => router.push('/expense/new')}
                  />
                ) : (
                  d.recent.map((e) => (
                    <ListRow
                      key={e.id}
                      icon={e.categoryIcon}
                      iconColor={e.categoryColor}
                      title={e.description}
                      subtitle={`${e.categoryName} · ${formatDateKey(e.spentDate)}`}
                      value={money(e.amountCents)}
                      onPress={() => router.push(`/expense/${e.id}`)}
                    />
                  ))
                )}
              </Card>

              <Card>
                <SectionHeader title="Income" action="Add" onAction={() => router.push('/income/new')} />
                {d.incomeList.length === 0 ? (
                  <Text variant="subhead" tone="secondary">
                    No income recorded this {period}. Shift earnings on the Work tab are estimates until you record the actual payment here.
                  </Text>
                ) : (
                  d.incomeList.map((i) => (
                    <ListRow
                      key={i.id}
                      icon="arrow.down.circle.fill"
                      iconColor={colors.success}
                      title={i.source}
                      subtitle={`${i.category[0]!.toUpperCase()}${i.category.slice(1)} · paid ${formatDateKey(i.payDate)}`}
                      value={money(i.amountCents)}
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

function ActionTile({ icon, tone, label, onPress }: { icon: string; tone: TileTone; label: string; onPress: () => void }) {
  const { colors } = useApp();
  const haptic = useHaptics();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      style={({ pressed }) => [styles.action, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <GradientTile icon={icon} tone={tone} size={36} />
      <Text variant="caption" style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <Row gap={spacing.sm}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="footnote" style={{ fontVariant: ['tabular-nums'], fontWeight: '600' }}>
        {value}
      </Text>
    </Row>
  );
}

function BudgetCard({ data: d, money }: { data: MoneyData; money: (cents: number) => string }) {
  const { colors } = useApp();
  const levelColor = (l: BudgetLevel) => (l === 'over' ? colors.danger : l === 'warning' ? colors.warning : colors.money);
  const catBudgets = d.budgets.filter((b) => b.categoryId !== null);
  if (!d.overall && catBudgets.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="chart.pie"
          title="No budget yet"
          message="Set a monthly budget to see what’s left and get a warning at 80%."
          action="Set budget"
          onAction={() => router.push('/budget/overall')}
        />
      </Card>
    );
  }
  const overall = d.overall ? budgetStatus(d.overall.limitCents, d.budgetSpent) : null;
  return (
    <Card>
      <SectionHeader title="Budgets" action="Edit" onAction={() => router.push('/budget/overall')} />
      <Text variant="footnote" tone="secondary">
        {formatDateKey(d.budgetRange.start)} – {formatDateKey(addDays(d.budgetRange.end, -1))}
      </Text>
      {overall ? (
        <View style={{ gap: 6 }}>
          <Row>
            <Text variant="subhead" style={{ flex: 1, fontWeight: '600' }}>
              Overall
            </Text>
            <Text variant="footnote" tone={overall.level === 'over' ? 'danger' : 'secondary'}>
              {money(overall.spentCents)} / {money(overall.limitCents)}
            </Text>
          </Row>
          <ProgressBar value={overall.usedBp / 10_000} color={levelColor(overall.level)} />
          <Text variant="footnote" tone={overall.level === 'over' ? 'danger' : overall.level === 'warning' ? 'warning' : 'secondary'}>
            {overall.level === 'over'
              ? `${money(-overall.remainingCents)} over budget`
              : overall.level === 'warning'
                ? `You’ve used ${Math.round(overall.usedBp / 100)}% · ${money(overall.remainingCents)} left`
                : `${money(overall.remainingCents)} left`}
          </Text>
        </View>
      ) : null}
      {catBudgets.map((b) => {
        const cat = d.budgetCats.find((c) => c.categoryId === b.categoryId);
        const s = budgetStatus(b.limitCents, cat?.totalCents ?? 0);
        return (
          <View key={b.id} style={{ gap: 4 }}>
            <Row>
              <Text variant="subhead" style={{ flex: 1 }}>
                {cat?.name ?? 'Category'}
              </Text>
              <Text variant="footnote" tone={s.level === 'over' ? 'danger' : 'secondary'}>
                {money(s.spentCents)} / {money(s.limitCents)}
              </Text>
            </Row>
            <ProgressBar value={s.usedBp / 10_000} color={levelColor(s.level)} height={6} />
          </View>
        );
      })}
      <Pressable accessibilityRole="button" onPress={() => router.push('/budget/categories')} hitSlop={6}>
        <Text variant="subhead" tone="accent">
          Category budgets
        </Text>
      </Pressable>
    </Card>
  );
}

function DailyChart({ range, daily, period }: { range: DateRange; daily: Map<DateKey, number>; period: Period }) {
  const { colors } = useApp();
  const days = eachDay(range);
  const max = Math.max(1, ...days.map((k) => daily.get(k) ?? 0));
  const today = todayKey();
  return (
    <View style={styles.chart} accessibilityLabel={`Daily spending chart, highest day ${formatCents(max)}`}>
      {days.map((k) => {
        const v = daily.get(k) ?? 0;
        return (
          <View key={k} style={styles.col}>
            <View style={styles.track}>
              <View style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 3 : 0, backgroundColor: k === today ? colors.accent : colors.money, borderRadius: 3 }} />
            </View>
            {period === 'week' ? (
              <Text variant="caption" tone="tertiary">
                {weekdayShort(k).slice(0, 1)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  balance: { fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: 0.2 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 2 },
  col: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  track: { flex: 1, width: '80%', justifyContent: 'flex-end' },
});
