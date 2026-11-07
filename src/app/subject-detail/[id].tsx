import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';
import { Button, Card, HeaderButton, Divider, EmptyState, ListRow, QueryView, Row, Screen, SectionHeader, Stat, Text } from '@/components/ui';
import { deleteStudySession, listAssessments, listStudySessions, listSubjects } from '@/database/repositories/study';
import { gradeBand, requiredAverageFor, summariseGrades } from '@/features/study/gradeMath';
import { useApp } from '@/services/AppContext';
import { useQuery } from '@/services/useQuery';
import { addDays, formatClock, formatDateKey, formatDuration, toDateKey, todayKey, dueLabel } from '@/utils/time';

export default function SubjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const subjectId = Number(id);
  const { db, notifyDataChanged } = useApp();
  const query = useQuery(
    async (d) => {
      const [subjects, assessments, sessions] = await Promise.all([
        listSubjects(d),
        listAssessments(d, subjectId),
        listStudySessions(d, { start: addDays(todayKey(), -30), end: addDays(todayKey(), 1) }),
      ]);
      return {
        subject: subjects.find((s) => s.id === subjectId) ?? null,
        assessments,
        sessions: sessions.filter((s) => s.subjectId === subjectId).reverse(),
        grades: summariseGrades(assessments),
      };
    },
    [subjectId],
  );

  return (
    <>
      <Stack.Screen options={{ title: query.data?.subject?.name ?? 'Subject', headerRight: () => <HeaderButton title="Edit" onPress={() => router.push(`/subject/${subjectId}`)} /> }} />
      <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing}>
        <QueryView query={query}>
          {({ subject, assessments, sessions, grades }) => {
            if (!subject) return <EmptyState icon="questionmark" title="Subject not found" message="It may have been deleted." />;
            const required = subject.targetPercent !== null ? requiredAverageFor(grades, subject.targetPercent) : null;
            return (
              <>
                <Card>
                  <Row align="start">
                    <Stat label="Confirmed" value={`${grades.confirmedPercent}%`} hint={`${grades.markedWeightBp / 100}% of subject marked`} />
                    <Stat
                      label="Projected"
                      value={grades.projectedPercent === null ? '—' : `${grades.projectedPercent}%`}
                      hint={grades.projectedPercent === null ? 'No marks yet' : `${gradeBand(grades.projectedPercent)} at current average`}
                    />
                  </Row>
                  {subject.targetPercent !== null ? (
                    <Text variant="footnote" tone="secondary">
                      {required === null
                        ? grades.markedWeightBp >= grades.totalWeightBp
                          ? `Target ${subject.targetPercent}%: all work is marked.`
                          : `Target ${subject.targetPercent}% is no longer reachable with the remaining work.`
                        : `To reach ${subject.targetPercent}%, average ${required}% on the remaining ${(grades.totalWeightBp - grades.markedWeightBp) / 100}%.`}
                    </Text>
                  ) : null}
                  {grades.issues.map((i) => (
                    <Text key={i} variant="footnote" tone="warning">
                      {i}
                    </Text>
                  ))}
                  <Text variant="caption" tone="tertiary">
                    Projections assume unmarked work scores your current average. Only confirmed marks count toward “Confirmed”.
                  </Text>
                </Card>

                <Card>
                  <SectionHeader title="Assessments" action="Add" onAction={() => router.push({ pathname: '/assessment/[id]', params: { id: 'new', subjectId } })} />
                  {assessments.length === 0 ? (
                    <Text variant="subhead" tone="secondary">
                      No assessments yet.
                    </Text>
                  ) : (
                    assessments.map((a, i) => (
                      <View key={a.id}>
                        {i > 0 ? <Divider /> : null}
                        <ListRow
                          title={a.title}
                          subtitle={`${a.weightBp / 100}% · ${a.dueAt ? formatDateKey(toDateKey(new Date(a.dueAt))) : 'No due date'}${a.status === 'pending' && a.dueAt ? ` · ${dueLabel(a.dueAt)}` : ''}`}
                          value={a.markObtained !== null && a.markTotal !== null ? `${a.markObtained}/${a.markTotal}` : a.status === 'submitted' ? 'Submitted' : 'Pending'}
                          valueTone={a.markObtained !== null ? 'primary' : 'tertiary'}
                          onPress={() => router.push(`/assessment/${a.id}`)}
                        />
                      </View>
                    ))
                  )}
                </Card>

                <Card>
                  <SectionHeader title="Recent sessions" action="Log" onAction={() => router.push({ pathname: '/study-log', params: { subjectId } })} />
                  {sessions.length === 0 ? (
                    <Text variant="subhead" tone="secondary">
                      No study sessions in the last 30 days.
                    </Text>
                  ) : (
                    sessions.slice(0, 10).map((s) => (
                      <ListRow
                        key={s.id}
                        icon="clock"
                        title={formatDateKey(s.sessionDate, { weekday: true })}
                        subtitle={`${formatClock(s.startedAt)} · ${s.endedAt ? formatDuration(Math.round((s.endedAt - s.startedAt) / 60_000)) : 'In progress'}`}
                        trailing={
                          <Button
                            title="Delete"
                            kind="plain"
                            onPress={() =>
                              Alert.alert('Delete session?', undefined, [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Delete', style: 'destructive', onPress: () => void deleteStudySession(db, s.id).then(() => notifyDataChanged('study')) },
                              ])
                            }
                          />
                        }
                      />
                    ))
                  )}
                </Card>
              </>
            );
          }}
        </QueryView>
      </Screen>
    </>
  );
}
