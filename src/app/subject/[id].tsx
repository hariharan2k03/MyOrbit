import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ColorField, FormScreen, FormSection, TextField } from '@/components/form';
import { createSubject, deleteSubject, listSubjects, updateSubject } from '@/database/repositories/study';
import { useApp } from '@/services/AppContext';
import { SWATCHES } from '@/theme/tokens';
import { unwrap } from '@/utils/result';
import { parseIntInput } from '@/utils/validation';

export default function SubjectForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { db } = useApp();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [goalHours, setGoalHours] = useState('');
  const [color, setColor] = useState<string>(SWATCHES[2]);

  useEffect(() => {
    if (isNew) return;
    void listSubjects(db).then((all) => {
      const s = all.find((x) => x.id === Number(id));
      if (!s) return;
      setCode(s.code ?? '');
      setName(s.name);
      setTarget(s.targetPercent === null ? '' : String(s.targetPercent));
      setGoalHours(s.weeklyGoalMinutes ? String(s.weeklyGoalMinutes / 60) : '');
      setColor(s.color);
    });
  }, [db, id, isNew]);

  const save = async () => {
    const hours = goalHours.trim() ? unwrap(parseIntInput(goalHours, 'Weekly goal', 0, 100)) : 0;
    const input = {
      code,
      name,
      color,
      targetPercent: target.trim() ? unwrap(parseIntInput(target, 'Target grade', 0, 100)) : null,
      weeklyGoalMinutes: hours * 60,
    };
    if (isNew) await createSubject(db, input);
    else await updateSubject(db, Number(id), input);
  };

  return (
    <FormScreen
      title={isNew ? 'New Subject' : 'Edit Subject'}
      domain="study"
      onSave={save}
      onDelete={isNew ? undefined : () => deleteSubject(db, Number(id))}
      deleteLabel="Delete subject and its assessments"
    >
      <FormSection>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Mobile App Development" maxLength={80} autoFocus={isNew} />
        <TextField label="Code" value={code} onChangeText={setCode} placeholder="e.g. INTE2667" autoCapitalize="characters" maxLength={20} />
        <TextField label="Target grade" value={target} onChangeText={setTarget} keyboardType="number-pad" placeholder="%" maxLength={3} />
        <TextField label="Weekly goal" value={goalHours} onChangeText={setGoalHours} keyboardType="number-pad" placeholder="hours" maxLength={3} last />
      </FormSection>
      <FormSection title="Colour">
        <ColorField value={color} onChange={setColor} last />
      </FormSection>
    </FormScreen>
  );
}
