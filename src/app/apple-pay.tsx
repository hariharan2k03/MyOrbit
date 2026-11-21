import { router } from 'expo-router';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, GradientTile, Icon, ListRow, QueryView, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { dismissPendingPurchase, listPendingPurchases, type PendingPurchase } from '@/database/repositories/finance';
import { completePendingPurchase } from '@/features/intents/intentActions';
import { useApp } from '@/services/AppContext';
import { lastApplePayRun } from '@/services/intentQueue';
import { useQuery } from '@/services/useQuery';
import { spacing } from '@/theme/tokens';
import { formatCents, parseMoneyToCents } from '@/utils/money';
import { formatClock, formatDateKey, monthRange, todayKey, toDateKey } from '@/utils/time';

const STEPS: { title: string; detail: string }[] = [
  { title: 'Open Shortcuts → Automation', detail: 'Tap the + (New Automation).' },
  { title: 'Choose “Wallet”', detail: 'Pick the cards to track (or all), keep “When I tap any category”, choose “Run Immediately”, then Next.' },
  { title: 'Tap “Create New Shortcut”', detail: 'If it asks “What do you want your shortcut to do?”, don’t type — tap Edit (top right). Then tap Add Action, search MyOrbit and add “Log Apple Pay Purchase”.' },
  { title: 'Fill in the three blanks', detail: 'Tap each one and pick from Shortcut Input: Merchant → Merchant, Amount → Amount, Card → Card or Pass.' },
  { title: 'Tap Done', detail: 'From now on every Apple Pay tap is saved as an expense. It shows here the next time you open MyOrbit.' },
];

interface PurchaseRow {
  id: number;
  description: string;
  amount_cents: number;
  spent_date: string;
  category: string;
  color: string;
}

/** How to set up automatic expense tracking from Apple Pay, plus what it has logged this month. */
export default function ApplePayScreen() {
  const { colors, db, notifyDataChanged } = useApp();
  const month = monthRange(todayKey());
  const query = useQuery(
    async (d) => {
      const [rows, pending] = await Promise.all([
        d.getAllAsync<PurchaseRow>(
          `SELECT e.id, e.description, e.amount_cents, e.spent_date, c.name AS category, c.color
           FROM expenses e JOIN expense_categories c ON c.id = e.category_id
           WHERE e.notes LIKE 'Apple Pay%' AND e.spent_date >= ? AND e.spent_date < ?
           ORDER BY e.spent_date DESC, e.id DESC`,
          [month.start, month.end],
        ),
        listPendingPurchases(d),
      ]);
      return { rows, pending };
    },
    [month.start],
  );

  const addAmount = (p: PendingPurchase) =>
    Alert.prompt(
      `Amount at ${p.merchant}`,
      `${formatDateKey(p.spentDate, { weekday: true })}${p.card ? ` · ${p.card}` : ''}`,
      [
        {
          text: 'Not mine',
          style: 'destructive',
          onPress: () => void dismissPendingPurchase(db, p.id).then(() => notifyDataChanged('money')),
        },
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (text?: string) => {
            const cents = parseMoneyToCents(text ?? '');
            if (!cents.ok) return Alert.alert('Check the amount', cents.error);
            void completePendingPurchase(db, p, cents.value)
              .then(() => notifyDataChanged('money'))
              .catch((e: unknown) => Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e)));
          },
        },
      ],
      'plain-text',
      '',
      'decimal-pad',
    );

  // Read on each refresh, so pull-to-refresh after a tap shows the new run.
  const lastRun = query.data !== undefined ? lastApplePayRun() : null;

  const openShortcuts = () =>
    Linking.openURL('shortcuts://').catch(() => Alert.alert('Shortcuts not found', 'Install the Shortcuts app from the App Store, then try again.'));

  return (
    <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing}>
      <Card>
        <Row>
          <GradientTile icon="wave.3.right" tone="money" size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">Track Apple Pay automatically</Text>
            <Text variant="subhead" tone="secondary">
              Each time you pay with your phone or watch, the store and amount are saved as an expense, with a category picked for you. Nothing leaves your iPhone.
            </Text>
          </View>
        </Row>
      </Card>

      <Card>
        <SectionHeader title="Automation status" />
        {lastRun ? (
          <Row align="start">
            <Icon name={lastRun.result === 'saved' ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'} color={lastRun.result === 'saved' ? colors.success : colors.warning} size={22} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="callout" style={{ fontWeight: '600' }}>
                Last run {toDateKey(new Date(lastRun.at)) === todayKey() ? 'today' : formatDateKey(toDateKey(new Date(lastRun.at)))} at {formatClock(lastRun.at)}
              </Text>
              <Text variant="footnote" tone="secondary">
                {lastRun.result === 'saved'
                  ? `Saved ${lastRun.amount || 'a purchase'}${lastRun.merchant ? ` at ${lastRun.merchant}` : ''}${lastRun.card ? ` (${lastRun.card})` : ''}.`
                  : `Wallet didn’t send an amount${lastRun.merchant ? ` for ${lastRun.merchant}` : ''}${lastRun.card ? ` (${lastRun.card})` : ''}${lastRun.amount ? ` (got “${lastRun.amount}”)` : ''}. The purchase is kept below — add the amount and it’s saved.`}
              </Text>
            </View>
          </Row>
        ) : (
          <Row align="start">
            <Icon name="questionmark.circle.fill" color={colors.textTertiary} size={22} />
            <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
              The automation hasn’t run MyOrbit yet. After setup, tap your bank card with Apple Pay (not Myki), then pull down here to refresh. If this still says “hasn’t run”, the Wallet automation isn’t firing — check it’s set to Run Immediately.
            </Text>
          </Row>
        )}
      </Card>

      <Card>
        <SectionHeader title="One-time setup (2 minutes)" />
        {STEPS.map((s, i) => (
          <View key={s.title}>
            {i > 0 ? <Divider /> : null}
            <Row align="start" style={styles.step}>
              <View style={[styles.num, { backgroundColor: colors.accentSoft }]}>
                <Text variant="subhead" tone="accent" style={{ fontWeight: '700' }}>
                  {i + 1}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="callout" style={{ fontWeight: '600' }}>
                  {s.title}
                </Text>
                <Text variant="footnote" tone="secondary">
                  {s.detail}
                </Text>
              </View>
            </Row>
          </View>
        ))}
        <Button title="Open Shortcuts" icon="arrow.up.forward.app" onPress={() => void openShortcuts()} />
      </Card>

      <Text variant="footnote" tone="tertiary">
        Only Apple Pay taps are seen — not card swipes, online payments or bank transfers; add those yourself. If a category is wrong, change it once and later purchases at that store follow.
      </Text>

      <QueryView query={query}>
        {({ pending }) =>
          pending.length === 0 ? null : (
            <Card style={{ paddingVertical: spacing.xs }}>
              <SectionHeader title={`Needs an amount · ${pending.length}`} />
              {pending.map((p, i) => (
                <View key={p.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    icon="exclamationmark.circle.fill"
                    iconColor={colors.warning}
                    title={p.merchant}
                    subtitle={`${formatDateKey(p.spentDate, { weekday: true })}${p.card ? ` · ${p.card}` : ''} · tap to add the amount`}
                    onPress={() => addAmount(p)}
                  />
                </View>
              ))}
            </Card>
          )
        }
      </QueryView>

      <QueryView query={query}>
        {({ rows }) => (
          <Card style={{ paddingVertical: rows.length ? spacing.xs : undefined }}>
            <SectionHeader title={`Logged this month · ${formatCents(rows.reduce((t, r) => t + r.amount_cents, 0))}`} />
            {rows.length === 0 ? (
              <Text variant="subhead" tone="secondary">
                Nothing yet. After setup, pay with Apple Pay and open MyOrbit — the purchase appears here.
              </Text>
            ) : (
              rows.slice(0, 30).map((r, i) => (
                <View key={r.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    icon="wave.3.right"
                    iconColor={r.color}
                    title={r.description}
                    subtitle={`${r.category} · ${formatDateKey(r.spent_date)}`}
                    value={formatCents(r.amount_cents)}
                    onPress={() => router.push(`/expense/${r.id}`)}
                  />
                </View>
              ))
            )}
          </Card>
        )}
      </QueryView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { paddingVertical: spacing.sm, gap: spacing.md },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
