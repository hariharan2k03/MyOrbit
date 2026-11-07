import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ChoiceField, DateField, FormScreen, FormSection, SwitchField, TextField, TimeField } from '@/components/form';
import { Button, Card, EmptyState, Loading } from '@/components/ui';
import {
  ASSESSMENT_KINDS,
  createAssessment,
  deleteAssessment,
  listAssessments,
  listSubjects,
  updateAssessment,
  type AssessmentKind,
  type Subject,
} from '@/database/repositories/study';
import { useApp } from '@/services/AppContext';
import { err, ok, unwrap, ValidationError, type Result } from '@/utils/result';
import { localDateTime, parseTime, toDateKey, toTimeValue, todayKey, addDays } from '@/utils/time';

/** Parses "12.5" style marks (up to 2 decimals). Marks aren't money, but we still reject junk input. */
function parseMark(input: string, label: string): Result<number> {
  const t = input.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return err(`${label} must be a number.`);
  return ok(Number(t));
}

/** Weighting "25" or "12.5" → basis points. */
function parseWeight(input: string): Result<number> {
  const t = input.trim().replace('%', '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return err('Weighting must be a percentage, e.g. 25.');
  const [w, f = ''] = t.split('.');
  const bp = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return bp > 10_000 ? err('Weighting cannot exceed 100%.') : ok(bp);
}

export default function AssessmentForm() {
  const { id, subjectId: subjectParam } = useLocalSearchParams<{ id: string; subjectId?: string }>();
  const isNew = id === 'new';
  const { db } = useApp();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(subjectParam ? Number(subjectParam) : null);
  const { kind: kindParam } = useLocalSearchParams<{ kind?: AssessmentKind }>();
  const [kind, setKind] = useState<AssessmentKind>(kindParam && ASSESSMENT_KINDS.includes(kindParam) ? kindParam : 'assignment');
  const [title, setTitle] = useState('');
  const [weight, setWeight] = useState('');
  const [hasDue, setHasDue] = useState(true);
  const [dueDate, setDueDate] = useState(addDays(todayKey(), 7));
  const [dueTime, setDueTime] = useState('23:55');
  const [mark, setMark] = useState('');
  const [total, setTotal] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void (async () => {
      const s = await listSubjects(db);
      setSubjects(s);
      if (isNew) {
        if (subjectId === null && s[0]) setSubjectId(s[0].id);
        return;
      }
      const a = (await listAssessments(db)).find((x) => x.id === Number(id));
      if (!a) return;
      setSubjectId(a.subjectId);
      setKind(a.kind);
      setTitle(a.title);
      setWeight(String(a.weightBp / 100));
      setHasDue(a.dueAt !== null);
      if (a.dueAt) {
        setDueDate(toDateKey(new Date(a.dueAt)));
        setDueTime(toTimeValue(a.dueAt));
      }
      setMark(a.markObtained === null ? '' : String(a.markObtained));
      setTotal(a.markTotal === null ? '' : String(a.markTotal));
      setNotes(a.notes ?? '');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, id, isNew]);

  if (!subjects) return <Loading />;
  if (subjects.length === 0) {
    return (
      <Card style={{ margin: 16 }}>
        <EmptyState icon="graduationcap" title="Add a subject first" message="Assessments belong to a subject." />
        <Button title="Add subject" onPress={() => router.replace('/subject/new')} />
      </Card>
    );
  }

  const save = async () => {
    if (subjectId === null) throw new ValidationError('Choose a subject.');
    const hasMark = mark.trim() !== '' || total.trim() !== '';
    const input = {
      subjectId,
      kind,
      title,
      weightBp: unwrap(parseWeight(weight)),
      dueAt: hasDue ? localDateTime(dueDate, unwrap(parseTime(dueTime))).getTime() : null,
      markObtained: hasMark ? unwrap(parseMark(mark, 'Mark')) : null,
      markTotal: hasMark ? unwrap(parseMark(total, 'Total')) : null,
      notes,
    };
    if (isNew) await createAssessment(db, input);
    else await updateAssessment(db, Number(id), input);
  };

  return (
    <FormScreen title={isNew ? 'New Assessment' : 'Edit Assessment'} domain="study" onSave={save} onDelete={isNew ? undefined : () => deleteAssessment(db, Number(id))} deleteLabel="Delete assessment">
      <FormSection title="Subject">
        <ChoiceField options={subjects.map((s) => ({ value: s.id, label: s.code ?? s.name, color: s.color }))} value={subjectId} onChange={setSubjectId} last />
      </FormSection>
      <FormSection title="Type">
        <ChoiceField options={ASSESSMENT_KINDS.map((k) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1) }))} value={kind} onChange={setKind} last />
      </FormSection>
      <FormSection>
        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Assignment 3" maxLength={120} />
        <TextField label="Weighting" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="%" maxLength={6} last />
      </FormSection>
      <FormSection title="Due">
        <SwitchField label="Has due date" value={hasDue} onChange={setHasDue} last={!hasDue} />
        {hasDue ? (
          <>
            <DateField label="Date" value={dueDate} onChange={setDueDate} />
            <TimeField label="Time" value={dueTime} onChange={setDueTime} last />
          </>
        ) : null}
      </FormSection>
      <FormSection title="Result" footer="Leave blank until marked. Entering a mark makes this a confirmed result.">
        <TextField label="Mark" value={mark} onChangeText={setMark} keyboardType="decimal-pad" placeholder="e.g. 24" maxLength={8} />
        <TextField label="Out of" value={total} onChangeText={setTotal} keyboardType="decimal-pad" placeholder="e.g. 30" maxLength={8} last />
      </FormSection>
      <FormSection title="Notes">
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional" maxLength={1000} last />
      </FormSection>
    </FormScreen>
  );
}
