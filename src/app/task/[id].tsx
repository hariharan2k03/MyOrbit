import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ChoiceField, DateField, FormScreen, FormSection, SwitchField, TextField } from '@/components/form';
import { createTask, deleteTask, listTasks, TASK_CATEGORIES, updateTask, type Priority, type TaskCategory } from '@/database/repositories/tasks';
import { RECURRENCES, type Recurrence } from '@/features/tasks/recurrence';
import { useApp } from '@/services/AppContext';
import { todayKey } from '@/utils/time';

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export default function TaskForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { db, colors } = useApp();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<Priority>(2);
  const [category, setCategory] = useState<TaskCategory>('personal');
  const [hasDue, setHasDue] = useState(true);
  const [dueDate, setDueDate] = useState(todayKey());
  const [recurrence, setRecurrence] = useState<Recurrence>('none');

  useEffect(() => {
    if (isNew) return;
    void listTasks(db, { status: 'all' }).then((all) => {
      const t = all.find((x) => x.id === Number(id));
      if (!t) return;
      setTitle(t.title);
      setNotes(t.notes ?? '');
      setPriority(t.priority);
      setCategory(t.category);
      setHasDue(t.dueDate !== null);
      if (t.dueDate) setDueDate(t.dueDate);
      setRecurrence(t.recurrence);
    });
  }, [db, id, isNew]);

  const save = async () => {
    const input = { title, notes, priority, category, dueDate: hasDue ? dueDate : null, recurrence: hasDue ? recurrence : 'none' as const };
    if (isNew) await createTask(db, input);
    else await updateTask(db, Number(id), input);
  };

  return (
    <FormScreen title={isNew ? 'New Task' : 'Edit Task'} domain="tasks" onSave={save} onDelete={isNew ? undefined : () => deleteTask(db, Number(id))} deleteLabel="Delete task">
      <FormSection>
        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="What needs doing?" maxLength={120} autoFocus={isNew} />
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional" maxLength={1000} last />
      </FormSection>
      <FormSection title="Priority">
        <ChoiceField
          options={[
            { value: 1 as Priority, label: 'High', color: colors.danger },
            { value: 2 as Priority, label: 'Medium', color: colors.warning },
            { value: 3 as Priority, label: 'Low', color: colors.textTertiary },
          ]}
          value={priority}
          onChange={setPriority}
          last
        />
      </FormSection>
      <FormSection title="Category">
        <ChoiceField options={TASK_CATEGORIES.map((c) => ({ value: c, label: cap(c) }))} value={category} onChange={setCategory} last />
      </FormSection>
      <FormSection title="Schedule" footer={recurrence !== 'none' ? 'Completing a repeating task moves it to the next due date.' : undefined}>
        <SwitchField label="Due date" value={hasDue} onChange={setHasDue} last={!hasDue} />
        {hasDue ? (
          <>
            <DateField label="Due" value={dueDate} onChange={setDueDate} />
            <ChoiceField label="Repeat" options={RECURRENCES.map((r) => ({ value: r, label: r === 'none' ? 'Never' : cap(r) }))} value={recurrence} onChange={setRecurrence} last />
          </>
        ) : null}
      </FormSection>
    </FormScreen>
  );
}
