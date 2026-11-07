import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Segmented } from '@/components/form';
import { Button, Card, Chip, EmptyState, Icon, QueryView, Row, Screen, Tag, Text } from '@/components/ui';
import { completeTask, listTasks, reopenTask, TASK_CATEGORIES, type Task, type TaskCategory } from '@/database/repositories/tasks';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { useQuery } from '@/services/useQuery';
import { radius, spacing } from '@/theme/tokens';
import { formatDateKey, todayKey } from '@/utils/time';

type Tab = 'today' | 'upcoming' | 'completed';

const PRIORITY = { 1: 'High', 2: 'Medium', 3: 'Low' } as const;
const CATEGORY_COLORS: Record<TaskCategory, string> = {
  personal: '#F472B6',
  work: '#22D3EE',
  study: '#8B6CFF',
  home: '#60A5FA',
  health: '#34D399',
  finance: '#FBBF24',
};
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export default function TasksScreen() {
  const { db, colors, notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const [tab, setTab] = useState<Tab>('today');
  const [category, setCategory] = useState<TaskCategory | null>(null);
  const [search, setSearch] = useState('');
  const today = todayKey();
  const query = useQuery((d) => listTasks(d, { status: tab === 'completed' ? 'done' : 'open', category, search }), [tab, category, search]);

  const toggle = async (t: Task) => {
    haptic('success');
    if (t.completedAt === null) await completeTask(db, t.id, today);
    else await reopenTask(db, t.id);
    notifyDataChanged('tasks');
  };

  // Today = due today, overdue, or undated; Upcoming = due after today.
  const filterTab = (tasks: Task[]) =>
    tab === 'today' ? tasks.filter((t) => t.dueDate === null || t.dueDate <= today) : tab === 'upcoming' ? tasks.filter((t) => t.dueDate !== null && t.dueDate > today) : tasks;

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: { placeholder: 'Search tasks', onChangeText: (e) => setSearch(e.nativeEvent.text), hideWhenScrolling: true },
        }}
      />
      <Screen
        largeTitle={false}
        onRefresh={() => void query.refresh()}
        refreshing={query.refreshing}
        overlay={
          <View style={styles.addWrap} pointerEvents="box-none">
            <Button title="Add Task" icon="plus" onPress={() => router.push('/task/new')} style={styles.add} />
          </View>
        }
      >
        <Segmented
          options={[
            { value: 'today', label: 'Today' },
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'completed', label: 'Completed' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          <Chip label="All" selected={category === null} onPress={() => setCategory(null)} />
          {TASK_CATEGORIES.map((c) => (
            <Chip key={c} label={cap(c)} color={CATEGORY_COLORS[c]} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
        <QueryView query={query}>
          {(all) => {
            const tasks = filterTab(all);
            return (
              <>
                <Text variant="title">
                  {tab === 'today' ? 'Today' : tab === 'upcoming' ? 'Upcoming' : 'Completed'} ({tasks.length})
                </Text>
                {tasks.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={tab === 'completed' ? 'tray' : 'checkmark.circle'}
                      title={tab === 'completed' ? 'Nothing completed yet' : 'All clear'}
                      message={tab === 'completed' ? 'Completed tasks appear here.' : 'Add a task to keep track of what needs doing.'}
                    />
                  </Card>
                ) : (
                  tasks.map((t) => {
                    const done = t.completedAt !== null;
                    const overdue = !done && t.dueDate !== null && t.dueDate < today;
                    return (
                      <Card key={t.id} style={{ padding: spacing.md }}>
                        <Row>
                          <Pressable
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: done }}
                            accessibilityLabel={`${done ? 'Reopen' : 'Complete'} ${t.title}`}
                            hitSlop={12}
                            onPress={() => void toggle(t)}
                            style={[
                              styles.check,
                              { borderColor: done ? colors.success : t.priority === 1 ? colors.danger : colors.textTertiary, backgroundColor: done ? colors.success : 'transparent' },
                            ]}
                          >
                            {done ? <Icon name="checkmark" color="#FFFFFF" size={12} /> : null}
                          </Pressable>
                          <Pressable accessibilityRole="button" onPress={() => router.push(`/task/${t.id}`)} style={{ flex: 1, gap: 6 }}>
                            <Text variant="callout" numberOfLines={2} style={done ? { textDecorationLine: 'line-through', opacity: 0.6 } : undefined}>
                              {t.title}
                            </Text>
                            <Row gap={6}>
                              <Tag label={cap(t.category)} color={CATEGORY_COLORS[t.category]} />
                              {t.priority === 1 ? <Tag label={PRIORITY[1]} color={colors.danger} /> : null}
                              {t.recurrence !== 'none' ? <Tag label={`Repeats ${t.recurrence}`} color={colors.textSecondary} /> : null}
                            </Row>
                          </Pressable>
                          {t.dueDate ? (
                            <Text variant="caption" tone={overdue ? 'danger' : 'secondary'}>
                              {overdue ? 'Overdue' : t.dueDate === today ? 'Today' : formatDateKey(t.dueDate)}
                            </Text>
                          ) : null}
                        </Row>
                      </Card>
                    );
                  })
                )}
              </>
            );
          }}
        </QueryView>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  // Sits above the iOS bottom search bar.
  addWrap: { position: 'absolute', left: 0, right: 0, bottom: 100, alignItems: 'center' },
  add: { minWidth: 220, borderRadius: radius.pill },
});
