import { router, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Card,
  EmptyState,
  Fab,
  GradientTile,
  Icon,
  IconButton,
  ProgressBar,
  ProgressRing,
  QueryView,
  Row,
  Screen,
  SectionHeader,
  Stat,
  Tag,
  Text,
} from '@/components/ui';
import { completeTask } from '@/database/repositories/tasks';
import { greetingFor, loadDashboard, type DashboardData } from '@/features/dashboard/dashboardData';
import { useAIAvailability } from '@/services/ai';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { useQuery } from '@/services/useQuery';
import { radius, spacing } from '@/theme/tokens';
import { formatCents } from '@/utils/money';
import { dateFromKey, dueLabel, formatClock, formatDateKey, formatDuration, toDateKey, weekdayShort } from '@/utils/time';

const CATEGORY_COLORS: Record<string, string> = {
  personal: '#F472B6',
  work: '#22D3EE',
  study: '#8B6CFF',
  home: '#60A5FA',
  health: '#34D399',
  finance: '#FBBF24',
};
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Align to the next minute boundary, then tick each minute (foreground only).
    let interval: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(t);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

/** Quick actions from the + button (Add shift, expense, task, study session, focus timer). */
function openQuickAdd() {
  const actions: { label: string; href: Href }[] = [
    { label: 'Task', href: '/task/new' },
    { label: 'Shift', href: '/shift/new' },
    { label: 'Expense', href: '/expense/new' },
    { label: 'Study session', href: '/study-log' },
    { label: 'Focus timer', href: '/focus' },
  ];
  ActionSheetIOS.showActionSheetWithOptions(
    { title: 'Add', options: [...actions.map((a) => a.label), 'Cancel'], cancelButtonIndex: actions.length },
    (i) => {
      const a = actions[i];
      if (a) router.push(a.href);
    },
  );
}

export default function HomeScreen() {
  const { settings } = useApp();
  const now = useClock();
  const query = useQuery((db) => loadDashboard(db));
  const name = settings.displayName.trim();
  // Personal AI is only offered where Apple Intelligence can actually run.
  const aiReady = useAIAvailability() === 'available';

  return (
    <Screen scene onRefresh={() => void query.refresh()} refreshing={query.refreshing} overlay={<Fab label="Add" onPress={openQuickAdd} />}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subhead" tone="secondary">
            {greetingFor(now)}
          </Text>
          <Text variant="largeTitle" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>
            {name || 'Welcome'}
          </Text>
          <Text variant="footnote" tone="tertiary">
            {formatDateKey(toDateKey(now), { weekday: true })} · {formatClock(now.getTime())}
          </Text>
        </View>
        <Row gap={spacing.sm}>
          {aiReady ? <IconButton icon="sparkles" label="Open Personal AI" onPress={() => router.push('/assistant')} /> : null}
          <IconButton icon="calendar" label="Open calendar" onPress={() => router.push('/calendar')} />
        </Row>
      </Row>

      <QueryView query={query}>
        {(data) => (
          <>
            <DateStrip data={data} />
            {data.activeSession ? <ActiveSessionBanner data={data} /> : null}
            {settings.dashboardCards.map((card) => {
              switch (card) {
                case 'glance':
                  return <GlanceGrid key={card} data={data} />;
                case 'focus':
                  return <FocusList key={card} data={data} />;
                case 'money':
                  return <MoneyCard key={card} data={data} />;
                case 'study':
                  return <StudyCard key={card} data={data} />;
                case 'week':
                  return <WeekCard key={card} data={data} />;
                default:
                  return null;
              }
            })}
          </>
        )}
      </QueryView>
    </Screen>
  );
}

function DateStrip({ data }: { data: DashboardData }) {
  const { colors } = useApp();
  const haptic = useHaptics();
  // Start scrolled so today is the first full tile, with the past days just off-screen to the left.
  const todayIndex = Math.max(0, data.days.findIndex((d) => d.date === data.today));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.stripScroll}
      contentContainerStyle={styles.strip}
      contentOffset={{ x: todayIndex * (DAY_WIDTH + spacing.sm), y: 0 }}
      snapToInterval={DAY_WIDTH + spacing.sm}
      decelerationRate="fast"
    >
      {data.days.map((d) => {
        const isToday = d.date === data.today;
        const label = `${weekdayShort(d.date)} ${dateFromKey(d.date).getDate()}`;
        return (
          <Pressable
            key={d.date}
            accessibilityRole="button"
            accessibilityLabel={`${formatDateKey(d.date, { weekday: true })}, ${d.count} items`}
            onPress={() => {
              haptic('select');
              router.push({ pathname: '/calendar', params: { date: d.date } });
            }}
            style={[styles.day, { backgroundColor: isToday ? undefined : colors.surface, borderColor: colors.border, overflow: 'hidden' }]}
          >
            {isToday ? (
              <LinearGradient colors={colors.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            ) : null}
            <Text variant="caption" color={isToday ? colors.onAccent : colors.textSecondary}>
              {label.split(' ')[0]}
            </Text>
            <Text variant="headline" color={isToday ? colors.onAccent : colors.text}>
              {label.split(' ')[1]}
            </Text>
            <View style={[styles.dot, { backgroundColor: d.count > 0 ? (isToday ? colors.onAccent : colors.accent) : 'transparent' }]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ActiveSessionBanner({ data }: { data: DashboardData }) {
  const { colors } = useApp();
  const s = data.activeSession!;
  return (
    <Card onPress={() => router.push('/focus')} accessibilityLabel={`${s.title} in progress. Open timer.`} style={{ backgroundColor: colors.accentSoft }}>
      <Row>
        <GradientTile icon="timer" tone="accent" size={36} />
        <View style={{ flex: 1 }}>
          <Text variant="headline">{s.title}</Text>
          <Text variant="footnote" tone="secondary">
            In progress · ends at {formatClock(s.endsAt)}
          </Text>
        </View>
        <Icon name="chevron.right" color={colors.textTertiary} size={12} />
      </Row>
    </Card>
  );
}

function GlanceTile({
  icon,
  tone,
  title,
  subtitle,
  href,
  accessory,
}: {
  icon: string;
  tone: 'tasks' | 'work' | 'study' | 'habits';
  title: string;
  subtitle: string;
  href: Href;
  accessory?: ReactNode;
}) {
  return (
    <Card onPress={() => router.push(href)} accessibilityLabel={`${title}, ${subtitle}`} style={styles.tile}>
      <Row gap={spacing.sm}>
        {accessory ?? <GradientTile icon={icon} tone={tone} size={34} />}
        <View style={{ flex: 1 }}>
          <Text variant="subhead" style={{ fontWeight: '600' }} numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </Row>
    </Card>
  );
}

function GlanceGrid({ data }: { data: DashboardData }) {
  const { colors } = useApp();
  const shiftToday = data.upcomingShifts.find((s) => s.shiftDate === data.today);
  const due = data.tasksDueToday.length;
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="Today at a Glance" />
      <View style={styles.grid}>
        <GlanceTile icon="checkmark" tone="tasks" title={`${due} ${due === 1 ? 'Task' : 'Tasks'}`} subtitle={due === 0 ? 'All clear' : 'left today'} href="/tasks" />
        <GlanceTile
          icon="briefcase.fill"
          tone="work"
          title="Work"
          subtitle={shiftToday ? formatClock(shiftToday.startAt) : 'No shift today'}
          href="/work"
        />
        <GlanceTile
          icon="book.fill"
          tone="study"
          title="Study"
          subtitle={data.studyTodayMinutes > 0 ? `${formatDuration(data.studyTodayMinutes)} today` : `${data.subjectCount} ${data.subjectCount === 1 ? 'subject' : 'subjects'}`}
          href="/study"
        />
        <GlanceTile
          icon="flame.fill"
          tone="habits"
          title="Habits"
          subtitle={data.habitsTotal === 0 ? 'None yet' : `${data.habitsDone} / ${data.habitsTotal} done`}
          href="/habits"
          accessory={
            <ProgressRing value={data.habitsTotal ? data.habitsDone / data.habitsTotal : 0} size={34} stroke={4} color={colors.habits} />
          }
        />
      </View>
    </View>
  );
}

function FocusList({ data }: { data: DashboardData }) {
  const { db, colors, notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const tasks = data.tasksDueToday.slice(0, 5);
  const assessment = data.nextAssessment;
  return (
    <Card>
      <SectionHeader title="Today's Focus" action="See all" onAction={() => router.push('/tasks')} />
      {tasks.length === 0 && !assessment ? (
        <EmptyState icon="sun.max" title="Nothing due today" message="Tasks due today and your next assessment show up here." />
      ) : null}
      {tasks.map((t) => (
        <Row key={t.id}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: false }}
            accessibilityLabel={`Complete ${t.title}`}
            hitSlop={10}
            onPress={() => {
              haptic('success');
              void completeTask(db, t.id, data.today).then(() => notifyDataChanged('tasks'));
            }}
            style={[styles.check, { borderColor: t.priority === 1 ? colors.danger : colors.textTertiary }]}
          />
          <Pressable accessibilityRole="button" onPress={() => router.push(`/task/${t.id}`)} style={{ flex: 1, gap: 4 }}>
            <Text variant="callout" numberOfLines={1}>
              {t.title}
            </Text>
            {t.dueDate! < data.today ? (
              <Text variant="caption" tone="danger">
                Overdue
              </Text>
            ) : null}
          </Pressable>
          <Tag label={cap(t.category)} color={CATEGORY_COLORS[t.category] ?? colors.accent} />
        </Row>
      ))}
      {assessment ? (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/assessment/${assessment.id}`)}>
          <Row>
            <GradientTile icon="doc.text.fill" tone="study" size={28} />
            <View style={{ flex: 1 }}>
              <Text variant="callout" numberOfLines={1}>
                {assessment.title}
              </Text>
              <Text variant="caption" tone="secondary">
                {assessment.subjectName} · {dueLabel(assessment.dueAt!)}
              </Text>
            </View>
            <Tag label="Study" color={colors.accent} />
          </Row>
        </Pressable>
      ) : null}
    </Card>
  );
}

function MoneyCard({ data }: { data: DashboardData }) {
  const { colors } = useApp();
  const b = data.budget;
  return (
    <Card onPress={() => router.push('/money')} accessibilityLabel="Open finance">
      <Row>
        <GradientTile icon="dollarsign" tone="money" size={34} />
        <Text variant="headline" style={{ flex: 1 }}>
          This month
        </Text>
        <Icon name="chevron.right" color={colors.textTertiary} size={12} />
      </Row>
      <Row align="start">
        <Stat label="Income" value={formatCents(data.monthIncomeCents, { showCents: false })} tone="success" />
        <Stat label="Spent" value={formatCents(data.monthExpenseCents, { showCents: false })} />
      </Row>
      {b ? (
        <View style={{ gap: spacing.xs }}>
          <ProgressBar value={b.usedBp / 10_000} color={b.level === 'over' ? colors.danger : b.level === 'warning' ? colors.warning : colors.money} />
          <Text variant="footnote" tone={b.level === 'over' ? 'danger' : b.level === 'warning' ? 'warning' : 'secondary'}>
            {b.remainingCents >= 0 ? `${formatCents(b.remainingCents)} left in budget` : `${formatCents(-b.remainingCents)} over budget`}
          </Text>
        </View>
      ) : (
        <Text variant="footnote" tone="secondary">
          Set a monthly budget in Finance to track what’s left.
        </Text>
      )}
      <Text variant="footnote" tone="tertiary">
        Estimated shift earnings this week: {formatCents(data.weekEstimatedEarningsCents)} (estimate, not income)
      </Text>
    </Card>
  );
}

function StudyCard({ data }: { data: DashboardData }) {
  const { colors } = useApp();
  const goal = data.studyWeekGoalMinutes;
  return (
    <Card onPress={() => router.push('/study')} accessibilityLabel="Open study">
      <Row>
        <GradientTile icon="graduationcap.fill" tone="study" size={34} />
        <Text variant="headline" style={{ flex: 1 }}>
          Study this week
        </Text>
        <Text variant="subhead" tone="secondary">
          {formatDuration(data.studyWeekMinutes)}
          {goal > 0 ? ` / ${formatDuration(goal)}` : ''}
        </Text>
      </Row>
      {goal > 0 ? (
        <ProgressBar value={data.studyWeekMinutes / goal} color={colors.study} />
      ) : (
        <Text variant="footnote" tone="secondary">
          Add a weekly goal to a subject to track progress.
        </Text>
      )}
    </Card>
  );
}

function WeekCard({ data }: { data: DashboardData }) {
  const { colors } = useApp();
  const max = Math.max(60, ...data.week.map((d) => d.workMinutes + d.studyMinutes));
  const total = data.week.reduce((s, d) => s + d.workMinutes + d.studyMinutes, 0);
  const tasks = data.week.reduce((s, d) => s + d.tasksDone, 0);
  return (
    <Card onPress={() => router.push('/insights')} accessibilityLabel="Open insights">
      <SectionHeader title="This week" />
      <View style={styles.chart} accessibilityLabel={`This week: ${formatDuration(total)} of work and study, ${tasks} tasks completed`}>
        {data.week.map((d) => {
          const workH = (d.workMinutes / max) * 100;
          const studyH = (d.studyMinutes / max) * 100;
          const isToday = d.date === data.today;
          return (
            <View key={d.date} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View style={{ height: `${studyH}%`, backgroundColor: colors.study, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                <View style={{ height: `${workH}%`, backgroundColor: colors.work, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
              </View>
              <Text variant="caption" tone={isToday ? 'accent' : 'tertiary'}>
                {weekdayShort(d.date).slice(0, 1)}
              </Text>
            </View>
          );
        })}
      </View>
      <Row gap={spacing.lg}>
        <Legend color={colors.work} label="Work" />
        <Legend color={colors.study} label="Study" />
        <Text variant="footnote" tone="secondary" style={{ marginLeft: 'auto' }}>
          {tasks} tasks done
        </Text>
      </Row>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Row gap={6}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text variant="footnote" tone="secondary">
        {label}
      </Text>
    </Row>
  );
}

const DAY_WIDTH = 64;

const styles = StyleSheet.create({
  // Bleeds to the screen edges so tiles scroll under them, while the first tile still lines up with the content.
  stripScroll: { marginHorizontal: -spacing.lg },
  strip: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  day: { width: DAY_WIDTH, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48.5%', padding: spacing.md },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2 },
  chart: { flexDirection: 'row', height: 110, gap: spacing.sm, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
});
