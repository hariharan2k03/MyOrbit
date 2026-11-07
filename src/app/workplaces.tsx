import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Divider, EmptyState, Fab, ListRow, QueryView, Screen } from '@/components/ui';
import { listWorkplaces, type Workplace } from '@/database/repositories/work';
import { useQuery } from '@/services/useQuery';
import { formatCents } from '@/utils/money';
import { formatTime12 } from '@/utils/time';

function penaltySummary(w: Workplace): string {
  const parts = [
    w.saturdayRateCents !== null ? `Sat ${formatCents(w.saturdayRateCents)}` : null,
    w.sundayRateCents !== null ? `Sun ${formatCents(w.sundayRateCents)}` : null,
    w.nightRateCents !== null && w.nightStartMin !== null && w.nightEndMin !== null
      ? `Night ${formatCents(w.nightRateCents)} (${formatTime12(w.nightStartMin)}–${formatTime12(w.nightEndMin)})`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No penalty rates set';
}

export default function WorkplacesScreen() {
  const query = useQuery((db) => listWorkplaces(db));
  return (
    <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing} overlay={<Fab label="Add workplace" onPress={() => router.push('/workplace/new')} />}>
      <QueryView query={query}>
        {(workplaces) => (
          <Card>
            {workplaces.length === 0 ? (
              <EmptyState icon="building.2" title="No workplaces" message="Add one with its base and penalty rates." />
            ) : (
              workplaces.map((w, i) => (
                <View key={w.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    icon="building.2.fill"
                    iconColor={w.color}
                    title={w.name}
                    subtitle={penaltySummary(w)}
                    value={`${formatCents(w.defaultRateCents)}/h`}
                    onPress={() => router.push(`/workplace/${w.id}`)}
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
