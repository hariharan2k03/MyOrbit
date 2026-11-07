import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ChoiceField, DateField, FormScreen, FormSection, TextField, TimeField } from '@/components/form';
import { Button, Card, EmptyState, Loading } from '@/components/ui';
import { listSubjects, logStudySession, type Subject } from '@/database/repositories/study';
import { useApp } from '@/services/AppContext';
import { unwrap, ValidationError } from '@/utils/result';
import { localDateTime, parseTime, toTimeValue, todayKey } from '@/utils/time';
import { parseIntInput } from '@/utils/validation';

/** Logs a study session that already happened. Use the Study timer for a live session. */
export default function StudyLog() {
  const { subjectId: param } = useLocalSearchParams<{ subjectId?: string }>();
  const { db } = useApp();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(param ? Number(param) : null);
  const [date, setDate] = useState(todayKey());
  const [start, setStart] = useState(() => toTimeValue(Date.now() - 60 * 60_000).replace(/\d$/, '0'));
  const [minutes, setMinutes] = useState('60');

  useEffect(() => {
    void listSubjects(db).then((s) => {
      setSubjects(s);
      setSubjectId((cur) => cur ?? s[0]?.id ?? null);
    });
  }, [db]);

  if (!subjects) return <Loading />;
  if (subjects.length === 0) {
    return (
      <Card style={{ margin: 16 }}>
        <EmptyState icon="graduationcap" title="Add a subject first" message="Study sessions are tracked per subject." />
        <Button title="Add subject" onPress={() => router.replace('/subject/new')} />
      </Card>
    );
  }

  const save = async () => {
    if (subjectId === null) throw new ValidationError('Choose a subject.');
    const startedAt = localDateTime(date, unwrap(parseTime(start))).getTime();
    const mins = unwrap(parseIntInput(minutes, 'Duration', 1, 600));
    if (startedAt + mins * 60_000 > Date.now() + 60_000) throw new ValidationError('A logged session can’t end in the future. Use the Study timer instead.');
    await logStudySession(db, subjectId, date, startedAt, mins);
  };

  return (
    <FormScreen title="Log Study Session" domain="study" onSave={save}>
      <FormSection title="Subject">
        <ChoiceField options={subjects.map((s) => ({ value: s.id, label: s.code ?? s.name, color: s.color }))} value={subjectId} onChange={setSubjectId} last />
      </FormSection>
      <FormSection>
        <DateField label="Date" value={date} onChange={setDate} />
        <TimeField label="Started" value={start} onChange={setStart} />
        <TextField label="Minutes" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" maxLength={3} last />
      </FormSection>
    </FormScreen>
  );
}
