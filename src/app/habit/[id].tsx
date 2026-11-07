import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ChoiceField, ColorField, FormScreen, FormSection, Segmented, TextField } from '@/components/form';
import { createHabit, deleteHabit, listHabitsWithStats, updateHabit } from '@/database/repositories/tasks';
import type { HabitFrequency } from '@/features/habits/streakMath';
import { useApp } from '@/services/AppContext';
import { SWATCHES } from '@/theme/tokens';
import { todayKey } from '@/utils/time';

export default function HabitForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { db } = useApp();
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<HabitFrequency>('daily');
  const [target, setTarget] = useState(3);
  const [color, setColor] = useState<string>(SWATCHES[4]);

  useEffect(() => {
    if (isNew) return;
    void listHabitsWithStats(db, todayKey()).then((all) => {
      const h = all.find((x) => x.id === Number(id));
      if (!h) return;
      setName(h.name);
      setFrequency(h.frequency);
      setTarget(h.targetPerPeriod);
      setColor(h.color);
    });
  }, [db, id, isNew]);

  const save = async () => {
    const input = { name, frequency, targetPerPeriod: target, color };
    if (isNew) await createHabit(db, input);
    else await updateHabit(db, Number(id), input);
  };

  return (
    <FormScreen title={isNew ? 'New Habit' : 'Edit Habit'} domain="habits" onSave={save} onDelete={isNew ? undefined : () => deleteHabit(db, Number(id))} deleteLabel="Delete habit and history">
      <FormSection>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Read 20 minutes" maxLength={80} autoFocus={isNew} last />
      </FormSection>
      <FormSection title="Frequency">
        <Segmented
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
          ]}
          value={frequency}
          onChange={setFrequency}
        />
      </FormSection>
      {frequency === 'weekly' ? (
        <FormSection title="Times per week">
          <ChoiceField options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))} value={target} onChange={setTarget} last />
        </FormSection>
      ) : null}
      <FormSection title="Colour">
        <ColorField value={color} onChange={setColor} last />
      </FormSection>
    </FormScreen>
  );
}
