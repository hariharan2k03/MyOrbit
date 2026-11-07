import { router } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, View } from 'react-native';
import { Segmented } from '@/components/form';
import { TimerCard } from '@/components/TimerCard';
import { Button, Card, Divider, EmptyState, Fab, GradientTile, Icon, ListRow, ProgressBar, QueryView, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { listAssessments, listSubjects, studyMinutesBySubject, type Assessment } from '@/database/repositories/study';
import type { SqlDb } from '@/database/types';
import { gradeBand, summariseGrades } from '@/features/study/gradeMath';
import { useApp } from '@/services/AppContext';
import { useQuery } from '@/services/useQuery';
import { spacing } from '@/theme/tokens';
import { diffDays, dueLabel, formatClock, formatDateKey, formatDuration, toDateKey, todayKey, weekRange } from '@/utils/time';

type Tab = 'subjects' | 'assignments' | 'exams';

async function loadStudy(db: SqlDb) {
  const [subjects, all, minutes] = await Promise.all([listSubjects(db), listAssessments(db), studyMinutesBySubject(db, weekRange(todayKey()))]);
  return {
    all,
    subjects: subjects.map((s) => {
      const mine = all.filter((a) => a.subjectId === s.id);
      return {
        ...s,
        weekMinutes: minutes.get(s.id) ?? 0,
        exams: mine.filter((a) => a.kind === 'exam').length,
        assignments: mine.filter((a) => a.kind !== 'exam').length,
        grades: summariseGrades(mine),
      };
    }),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function openAdd() {
  ActionSheetIOS.showActionSheetWithOptions({ title: 'Add', options: ['Subject', 'Assignment', 'Exam', 'Log study session', 'Cancel'], cancelButtonIndex: 4 }, (i) => {
    if (i === 0) router.push('/subject/new');
    if (i === 1) router.push({ pathname: '/assessment/[id]', params: { id: 'new', kind: 'assignment' } });
    if (i === 2) router.push({ pathname: '/assessment/[id]', params: { id: 'new', kind: 'exam' } });
    if (i === 3) router.push('/study-log');
  });
}

export default function StudyScreen() {
  const { colors } = useApp();
  const [tab, setTab] = useState<Tab>('subjects');
  const query = useQuery(loadStudy);

  return (
    <Screen title="Study" onRefresh={() => void query.refresh()} refreshing={query.refreshing} overlay={<Fab label="Add" onPress={openAdd} />}>
      <Segmented
        options={[
          { value: 'subjects', label: 'Subjects' },
          { value: 'assignments', label: 'Assignments' },
          { value: 'exams', label: 'Exams' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <QueryView query={query}>
        {({ subjects, all }) => {
          const timer = <TimerCard hasSubjects={subjects.length > 0} />;
          if (subjects.length === 0) {
            return (
              <>
                {timer}
                <Card>
                  <EmptyState
                    icon="graduationcap"
                    title="Add your subjects"
                    message="Track assignments, exams, marks, weightings and study time for each unit."
                    action="Add subject"
                    onAction={() => router.push('/subject/new')}
                  />
                </Card>
              </>
            );
          }

          if (tab === 'subjects') {
            return (
              <>
                {timer}
                <Button title="Log a study session" kind="secondary" icon="book.fill" onPress={() => router.push('/study-log')} />
                {subjects.map((s) => {
                  const g = s.grades;
                  return (
                    <Card key={s.id} onPress={() => router.push(`/subject-detail/${s.id}`)} accessibilityLabel={`Open ${s.name}`}>
                      <Row>
                        <GradientTile icon="book.closed.fill" color={s.color} size={44} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="headline" numberOfLines={1}>
                            {s.name}
                          </Text>
                          <Text variant="footnote" tone="secondary">
                            {plural(s.assignments, 'assignment')} · {plural(s.exams, 'exam')}
                          </Text>
                        </View>
                        {g.currentAveragePercent !== null ? (
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text variant="headline">{g.currentAveragePercent}%</Text>
                            <Text variant="caption" tone="secondary">
                              {gradeBand(g.currentAveragePercent)}
                            </Text>
                          </View>
                        ) : (
                          <Icon name="chevron.right" color={colors.textTertiary} size={12} />
                        )}
                      </Row>
                      {s.weeklyGoalMinutes > 0 ? (
                        <View style={{ gap: 4 }}>
                          <ProgressBar value={s.weekMinutes / s.weeklyGoalMinutes} color={s.color} height={6} />
                          <Text variant="caption" tone="tertiary">
                            {formatDuration(s.weekMinutes)} of {formatDuration(s.weeklyGoalMinutes)} this week
                          </Text>
                        </View>
                      ) : null}
                      {g.issues.length > 0 && g.totalWeightBp > 0 ? (
                        <Text variant="footnote" tone="warning">
                          {g.issues[0]}
                        </Text>
                      ) : null}
                    </Card>
                  );
                })}
              </>
            );
          }

          const wantExams = tab === 'exams';
          const list = all.filter((a) => (a.kind === 'exam') === wantExams);
          const upcoming = list.filter((a) => a.status === 'pending').sort((x, y) => (x.dueAt ?? Infinity) - (y.dueAt ?? Infinity));
          const done = list.filter((a) => a.status !== 'pending');
          const noun = wantExams ? 'exam' : 'assignment';
          return (
            <>
              <Card>
                <SectionHeader title="Upcoming" action="Add" onAction={() => router.push({ pathname: '/assessment/[id]', params: { id: 'new', kind: wantExams ? 'exam' : 'assignment' } })} />
                {upcoming.length === 0 ? (
                  <EmptyState icon={wantExams ? 'pencil.and.list.clipboard' : 'doc.text'} title={`No upcoming ${noun}s`} message={`Add ${noun}s with a due date to see them here.`} />
                ) : (
                  upcoming.map((a, i) => <AssessmentRow key={a.id} a={a} first={i === 0} />)
                )}
              </Card>
              {done.length > 0 ? (
                <Card>
                  <SectionHeader title="Submitted & marked" />
                  {done.map((a, i) => (
                    <AssessmentRow key={a.id} a={a} first={i === 0} />
                  ))}
                </Card>
              ) : null}
            </>
          );
        }}
      </QueryView>
      <View style={{ height: spacing.sm }} />
    </Screen>
  );
}

function AssessmentRow({ a, first }: { a: Assessment; first: boolean }) {
  const soon = a.dueAt !== null && a.status === 'pending' && diffDays(todayKey(), toDateKey(new Date(a.dueAt))) <= 2;
  const value =
    a.markObtained !== null && a.markTotal !== null ? `${a.markObtained}/${a.markTotal}` : a.status === 'pending' && a.dueAt ? dueLabel(a.dueAt) : a.status === 'submitted' ? 'Submitted' : undefined;
  return (
    <View>
      {!first ? <Divider /> : null}
      <ListRow
        icon={a.kind === 'exam' ? 'pencil.and.list.clipboard' : 'doc.text.fill'}
        iconColor={a.subjectColor}
        title={a.title}
        subtitle={[a.subjectName, a.dueAt ? `${formatDateKey(toDateKey(new Date(a.dueAt)), { weekday: true })}, ${formatClock(a.dueAt)}` : 'No due date', `${a.weightBp / 100}%`].join(' · ')}
        value={value}
        valueTone={soon ? 'warning' : a.markObtained !== null ? 'primary' : 'secondary'}
        onPress={() => router.push(`/assessment/${a.id}`)}
      />
    </View>
  );
}
