import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Pressable, StyleSheet, View } from 'react-native';
import { Segmented } from '@/components/form';
import { Card, EmptyState, Fab, Icon, IconButton, QueryView, Row, Screen, Text } from '@/components/ui';
import { loadCalendar, type CalendarItem, type CalendarKind } from '@/features/calendar/calendarData';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { useQuery } from '@/services/useQuery';
import { radius, spacing } from '@/theme/tokens';
import {
  addDays,
  addMonths,
  dateFromKey,
  eachDay,
  formatClock,
  formatDateKey,
  formatTimeRange,
  isValidDateKey,
  monthLabel,
  monthRange,
  startOfWeek,
  todayKey,
  weekRange,
  weekdayShort,
  type DateKey,
  type DateRange,
} from '@/utils/time';

type Mode = 'month' | 'week' | 'day';

export default function CalendarScreen() {
  const { colors } = useApp();
  const haptic = useHaptics();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const [mode, setMode] = useState<Mode>(date ? 'day' : 'month');
  const [selected, setSelected] = useState(() => (date && isValidDateKey(date) ? date : todayKey()));
  const today = todayKey();
  const tint: Record<CalendarKind, string> = { shift: colors.work, assessment: colors.study, study: '#A3E635', task: colors.tasks, event: colors.accent };

  // Month view loads the full 6-week grid so leading/trailing days have dots too.
  const gridStart = startOfWeek(monthRange(selected).start);
  const range: DateRange =
    mode === 'day' ? { start: selected, end: addDays(selected, 1) } : mode === 'week' ? weekRange(selected) : { start: gridStart, end: addDays(gridStart, 42) };
  const query = useQuery((db) => loadCalendar(db, range), [range.start, range.end]);

  const move = (dir: 1 | -1) => setSelected((s) => (mode === 'day' ? addDays(s, dir) : mode === 'week' ? addDays(s, 7 * dir) : addMonths(s, dir)));
  const title =
    mode === 'month' ? monthLabel(selected) : mode === 'week' ? `${formatDateKey(range.start)} – ${formatDateKey(addDays(range.end, -1))}` : formatDateKey(selected, { weekday: true });

  const add = () => {
    const options = ['Shift', 'Task', 'Assessment', 'Study session', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: `Add on ${formatDateKey(selected, { weekday: true })}`, options, cancelButtonIndex: 4 }, (i) => {
      if (i === 0) router.push({ pathname: '/shift/[id]', params: { id: 'new', date: selected } });
      if (i === 1) router.push('/task/new');
      if (i === 2) router.push('/assessment/new');
      if (i === 3) router.push('/study-log');
    });
  };

  const itemColor = (i: CalendarItem) => i.color ?? tint[i.kind];

  /** Reference-style event card: coloured bar, title, time range underneath. */
  const renderItem = (i: CalendarItem) => (
    <Pressable
      key={i.key}
      accessibilityRole="button"
      accessibilityLabel={`${i.title}, ${i.startAt && i.endAt ? formatTimeRange(i.startAt, i.endAt) : i.allDay ? 'all day' : i.subtitle}`}
      onPress={() => router.push(i.href as Href)}
      style={({ pressed }) => [styles.item, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.bar, { backgroundColor: itemColor(i) }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="callout" style={[{ fontWeight: '600' }, i.done && i.kind === 'task' ? { textDecorationLine: 'line-through', opacity: 0.6 } : null]} numberOfLines={1}>
          {i.title}
        </Text>
        <Text variant="footnote" tone="secondary" numberOfLines={1}>
          {i.startAt && i.endAt ? formatTimeRange(i.startAt, i.endAt) : i.startAt ? formatClock(i.startAt) : i.allDay ? 'All day' : i.subtitle}
        </Text>
        {i.startAt && i.subtitle ? (
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {i.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  const dayHeading = (k: DateKey) => (
    <Text variant="headline" tone={k === today ? 'accent' : 'primary'}>
      {formatDateKey(k, { weekday: true })}
    </Text>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Row gap={spacing.sm}>
              <Pressable accessibilityRole="button" onPress={() => setSelected(today)} hitSlop={8}>
                <Text color={colors.text} style={{ paddingHorizontal: 4 }}>
                  Today
                </Text>
              </Pressable>
            </Row>
          ),
        }}
      />
      <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing} overlay={<Fab label="Add" onPress={add} />}>
        <Segmented
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <Row>
          <IconButton icon="chevron.left" label="Previous" onPress={() => move(-1)} />
          <Text variant="headline" style={{ flex: 1, textAlign: 'center' }}>
            {title}
          </Text>
          <IconButton icon="chevron.right" label="Next" onPress={() => move(1)} />
        </Row>
        <QueryView query={query}>
          {(byDay) => (
            <>
              {mode === 'month' ? (
                <Card style={{ padding: spacing.sm }}>
                  <View style={styles.week}>
                    {eachDay({ start: gridStart, end: addDays(gridStart, 7) }).map((k) => (
                      <Text key={k} variant="caption" tone="tertiary" style={styles.dow}>
                        {weekdayShort(k)}
                      </Text>
                    ))}
                  </View>
                  {[0, 1, 2, 3, 4, 5].map((w) => (
                    <View key={w} style={styles.week}>
                      {eachDay({ start: addDays(gridStart, w * 7), end: addDays(gridStart, w * 7 + 7) }).map((k) => {
                        const items = byDay.get(k) ?? [];
                        const inMonth = k.slice(0, 7) === selected.slice(0, 7);
                        const isSel = k === selected;
                        const dots = [...new Set(items.map(itemColor))].slice(0, 3);
                        return (
                          <Pressable
                            key={k}
                            accessibilityRole="button"
                            accessibilityLabel={`${formatDateKey(k, { weekday: true })}, ${items.length} items`}
                            accessibilityState={{ selected: isSel }}
                            onPress={() => {
                              haptic('select');
                              setSelected(k);
                            }}
                            style={styles.cell}
                          >
                            <View style={[styles.day, isSel && { backgroundColor: colors.accent }, !isSel && k === today && { borderWidth: 1.5, borderColor: colors.accent }]}>
                              <Text variant="subhead" style={{ fontWeight: isSel ? '700' : '500' }} color={isSel ? colors.onAccent : inMonth ? colors.text : colors.textTertiary}>
                                {dateFromKey(k).getDate()}
                              </Text>
                            </View>
                            <View style={styles.dots}>
                              {dots.map((c) => (
                                <View key={c} style={[styles.dot, { backgroundColor: c }]} />
                              ))}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </Card>
              ) : null}

              {mode === 'week' ? (
                eachDay(range).map((k) => {
                  const items = byDay.get(k) ?? [];
                  return (
                    <View key={k} style={{ gap: spacing.sm }}>
                      {dayHeading(k)}
                      {items.length === 0 ? (
                        <Text variant="footnote" tone="tertiary">
                          Nothing scheduled
                        </Text>
                      ) : (
                        items.map(renderItem)
                      )}
                    </View>
                  );
                })
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {dayHeading(selected)}
                  {(byDay.get(selected) ?? []).length === 0 ? (
                    <Card>
                      <EmptyState icon="calendar" title="Nothing on this day" message="Shifts, classes, assessments, study sessions and tasks show up here." />
                    </Card>
                  ) : (
                    byDay.get(selected)!.map(renderItem)
                  )}
                </View>
              )}

              <Pressable accessibilityRole="button" onPress={() => router.push('/calendar-feeds' as Href)} style={({ pressed }) => [styles.feeds, { opacity: pressed ? 0.6 : 1 }]}>
                <Icon name="link" color={colors.accent} size={14} />
                <Text variant="subhead" tone="accent">
                  Subscribed calendars (uni timetable)
                </Text>
              </Pressable>
            </>
          )}
        </QueryView>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row' },
  dow: { flex: 1, textAlign: 'center', paddingVertical: spacing.xs },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3, gap: 2 },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 2, height: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  bar: { width: 5, alignSelf: 'stretch', borderRadius: 3, minHeight: 34 },
  feeds: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: spacing.md },
});
