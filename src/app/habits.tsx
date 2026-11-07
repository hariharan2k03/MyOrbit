import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Segmented } from '@/components/form';
import { Card, EmptyState, Fab, Icon, ProgressRing, QueryView, Row, Screen, Text } from '@/components/ui';
import { habitHistory, listHabitsWithStats, toggleHabit, type HabitWithStats } from '@/database/repositories/tasks';
import type { HabitFrequency } from '@/features/habits/streakMath';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { useQuery } from '@/services/useQuery';
import { spacing } from '@/theme/tokens';
import { addDays, eachDay, todayKey } from '@/utils/time';

const HISTORY_DAYS = 14;

export default function HabitsScreen() {
  const { db, colors, notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const [tab, setTab] = useState<HabitFrequency>('daily');
  const today = todayKey();
  const from = addDays(today, -(HISTORY_DAYS - 1));
  const query = useQuery(
    async (d) => {
      const habits = await listHabitsWithStats(d, today);
      const history = await Promise.all(habits.map((h) => habitHistory(d, h.id, from)));
      return habits.map((h, i) => ({ habit: h, days: new Set(history[i]) }));
    },
    [today],
  );

  const toggle = async (h: HabitWithStats) => {
    const done = await toggleHabit(db, h.id, today);
    haptic(done ? 'success' : 'tap');
    notifyDataChanged('habits');
  };

  const days = eachDay({ start: from, end: addDays(today, 1) });

  return (
    <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing} overlay={<Fab label="Add habit" onPress={() => router.push('/habit/new')} />}>
      <Segmented
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <QueryView query={query}>
        {(all) => {
          const items = all.filter((x) => x.habit.frequency === tab);
          if (items.length === 0) {
            return (
              <Card>
                <EmptyState
                  icon="flame"
                  title={tab === 'daily' ? 'No daily habits' : 'No weekly habits'}
                  message="Track routines and watch your streaks grow."
                  action="Add habit"
                  onAction={() => router.push('/habit/new')}
                />
              </Card>
            );
          }
          return items.map(({ habit: h, days: logged }) => {
            const done = h.frequency === 'daily' ? h.doneToday : h.stats.periodDone;
            const unit = h.frequency === 'daily' ? 'day' : 'week';
            return (
              <Card key={h.id} style={{ padding: spacing.md }}>
                <Row>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: h.doneToday }}
                    accessibilityLabel={`Mark ${h.name} done today`}
                    hitSlop={10}
                    onPress={() => void toggle(h)}
                    style={[styles.check, { backgroundColor: h.doneToday ? colors.success : 'transparent', borderColor: h.doneToday ? colors.success : colors.textTertiary }]}
                  >
                    {h.doneToday ? <Icon name="checkmark" color="#FFFFFF" size={16} /> : null}
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${h.name}`} onPress={() => router.push(`/habit/${h.id}`)} style={{ flex: 1, gap: 2 }}>
                    <Text variant="headline">{h.name}</Text>
                    <Text variant="footnote" tone="secondary">
                      {h.stats.currentStreak > 0 ? `${h.stats.currentStreak} ${unit} streak` : h.frequency === 'weekly' ? `${h.stats.periodCount} of ${h.targetPerPeriod} this week` : 'Start a streak today'}
                      {h.stats.longestStreak > h.stats.currentStreak ? ` · best ${h.stats.longestStreak}` : ''}
                    </Text>
                  </Pressable>
                  {h.frequency === 'weekly' ? (
                    <ProgressRing value={h.stats.periodCount / h.targetPerPeriod} size={36} stroke={4} color={done ? colors.success : h.color}>
                      <Text variant="caption">{h.stats.periodCount}</Text>
                    </ProgressRing>
                  ) : (
                    <Icon name="chevron.right" color={colors.textTertiary} size={12} />
                  )}
                </Row>
                <View style={styles.history} accessibilityLabel={`${logged.size} completions in the last ${HISTORY_DAYS} days`}>
                  {days.map((k) => (
                    <View key={k} style={[styles.cell, { backgroundColor: logged.has(k) ? h.color : colors.border }]} />
                  ))}
                </View>
              </Card>
            );
          });
        }}
      </QueryView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  check: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  history: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, height: 6, borderRadius: 3 },
});
