import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Donut, GradientTile, Icon, QueryView, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { loadInsights } from '@/features/insights/insightsData';
import { useApp } from '@/services/AppContext';
import { useQuery } from '@/services/useQuery';
import { spacing, type TileTone } from '@/theme/tokens';
import { addDays, formatDateKey, formatDuration } from '@/utils/time';

export default function InsightsScreen() {
  const { colors } = useApp();
  const query = useQuery((db) => loadInsights(db));

  return (
    <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing}>
      <QueryView query={query}>
        {(d) => {
          const total = d.workMinutes + d.studyMinutes;
          const pct = (m: number) => (total ? `${Math.round((m / total) * 100)}%` : '0%');
          const taskDelta = d.tasksDone - d.tasksDoneLastWeek;
          return (
            <>
              <Card>
                <SectionHeader title="Your Week" />
                <Text variant="footnote" tone="secondary">
                  {formatDateKey(d.week.start)} – {formatDateKey(addDays(d.week.end, -1))}
                </Text>
                <Row>
                  <Donut
                    size={130}
                    stroke={16}
                    segments={[
                      { value: d.workMinutes, color: colors.work },
                      { value: d.studyMinutes, color: colors.study },
                    ]}
                  >
                    <Text variant="title">{formatDuration(total)}</Text>
                    <Text variant="caption" tone="secondary">
                      logged
                    </Text>
                  </Donut>
                  <View style={{ flex: 1, gap: spacing.sm }}>
                    <Legend color={colors.work} label="Work" value={`${formatDuration(d.workMinutes)} · ${pct(d.workMinutes)}`} />
                    <Legend color={colors.study} label="Study" value={`${formatDuration(d.studyMinutes)} · ${pct(d.studyMinutes)}`} />
                    <Legend color={colors.tasks} label="Tasks done" value={String(d.tasksDone)} />
                    <Legend color={colors.habits} label="Habits today" value={d.habitsTotal ? `${d.habitsDoneToday}/${d.habitsTotal}` : '—'} />
                  </View>
                </Row>
                {total === 0 ? (
                  <Text variant="footnote" tone="tertiary">
                    Log shifts and study sessions to see how your week splits.
                  </Text>
                ) : null}
              </Card>

              <Text variant="headline">Highlights</Text>
              <Highlight
                icon="flame.fill"
                tone="amber"
                title={d.bestStreak ? `${d.bestStreak.days} ${d.bestStreak.unit} streak` : 'No active streak'}
                subtitle={d.bestStreak ? `${d.bestStreak.name} · keep it up!` : 'Complete a habit today to start one.'}
                onPress={() => router.push('/habits')}
              />
              <Highlight
                icon="checkmark"
                tone="tasks"
                title={`${d.tasksDone} ${d.tasksDone === 1 ? 'task' : 'tasks'} completed`}
                subtitle={
                  d.tasksDoneLastWeek === 0
                    ? 'This week'
                    : `${taskDelta >= 0 ? '+' : ''}${taskDelta} vs last week (${d.tasksDoneLastWeek})`
                }
                onPress={() => router.push('/tasks')}
              />
              <Highlight
                icon="clock.fill"
                tone="study"
                title={`${formatDuration(d.workMinutes)} worked`}
                subtitle="Paid hours from this week’s shifts"
                onPress={() => router.push('/work')}
              />
              <Highlight
                icon="calendar"
                tone="accent"
                title={`${d.activeDays30} active ${d.activeDays30 === 1 ? 'day' : 'days'}`}
                subtitle="Days with activity in the last 30"
                onPress={() => router.push('/calendar')}
              />
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <Row gap={spacing.sm}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="footnote" style={{ fontWeight: '600' }}>
        {value}
      </Text>
    </Row>
  );
}

function Highlight({ icon, tone, title, subtitle, onPress }: { icon: string; tone: TileTone; title: string; subtitle: string; onPress: () => void }) {
  const { colors } = useApp();
  return (
    <Card onPress={onPress} accessibilityLabel={`${title}. ${subtitle}`} style={{ padding: spacing.md }}>
      <Row>
        <GradientTile icon={icon} tone={tone} size={38} />
        <View style={{ flex: 1 }}>
          <Text variant="headline">{title}</Text>
          <Text variant="footnote" tone="secondary">
            {subtitle}
          </Text>
        </View>
        <Icon name="chevron.right" color={colors.textTertiary} size={12} />
      </Row>
    </Card>
  );
}
