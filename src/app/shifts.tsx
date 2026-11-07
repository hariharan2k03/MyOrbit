import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Card, Divider, EmptyState, Fab, IconButton, ListRow, QueryView, Row, Screen, Text } from '@/components/ui';
import { listShiftsInRange } from '@/database/repositories/work';
import { shiftPay } from '@/features/work/payRates';
import { openShiftActions } from '@/features/work/shiftActions';
import { shiftPhase } from '@/features/work/shiftMath';
import { useApp } from '@/services/AppContext';
import { useQuery } from '@/services/useQuery';
import { formatCents } from '@/utils/money';
import { addDays, formatDateKey, formatTimeRange, todayKey, weekRange } from '@/utils/time';

/** My Shifts: every shift in a week, with status and estimated gross pay. */
export default function ShiftsScreen() {
  const { db, colors, notifyDataChanged } = useApp();
  const [anchor, setAnchor] = useState(todayKey());
  const week = weekRange(anchor);
  const query = useQuery(async (d) => ({ shifts: await listShiftsInRange(d, week), now: Date.now() }), [week.start]);

  return (
    <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing} overlay={<Fab label="Add shift" onPress={() => router.push('/shift/new')} />}>
      <Row>
        <IconButton icon="chevron.left" label="Previous week" onPress={() => setAnchor((a) => addDays(a, -7))} />
        <Text variant="headline" style={{ flex: 1, textAlign: 'center' }}>
          {formatDateKey(week.start)} – {formatDateKey(addDays(week.end, -1))}
        </Text>
        <IconButton icon="chevron.right" label="Next week" onPress={() => setAnchor((a) => addDays(a, 7))} />
      </Row>
      <QueryView query={query}>
        {({ shifts, now }) => (
          <Card>
            {shifts.length === 0 ? (
              <EmptyState icon="calendar.badge.plus" title="No shifts this week" message="Tap + to add one." />
            ) : (
              shifts.map((s, i) => {
                const phase = shiftPhase(s, now);
                const status =
                  s.status === 'cancelled' ? 'Cancelled' : s.status === 'completed' ? 'Completed' : phase === 'in_progress' ? 'In progress' : phase === 'finished' ? 'Finished' : 'Upcoming';
                return (
                  <View key={s.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow
                      icon="briefcase.fill"
                      iconColor={s.status === 'cancelled' ? colors.textTertiary : s.workplaceColor}
                      title={`${formatDateKey(s.shiftDate, { weekday: true })} · ${s.workplaceName}`}
                      subtitle={`${formatTimeRange(s.startAt, s.endAt)} · ${status}`}
                      value={s.status === 'cancelled' ? undefined : formatCents(shiftPay(s, s.rates).grossCents)}
                      strike={s.status === 'cancelled'}
                      onPress={() => openShiftActions(db, s, () => notifyDataChanged('work'))}
                    />
                  </View>
                );
              })
            )}
          </Card>
        )}
      </QueryView>
    </Screen>
  );
}
