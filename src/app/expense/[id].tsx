import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ChoiceField, DateField, FormScreen, FormSection, MoneyField, TextField } from '@/components/form';
import { Loading } from '@/components/ui';
import { createExpense, deleteExpense, getExpense, listCategories, updateExpense, type ExpenseCategory } from '@/database/repositories/finance';
import { useApp } from '@/services/AppContext';
import { centsToInput, parseMoneyToCents } from '@/utils/money';
import { unwrap, ValidationError } from '@/utils/result';
import { todayKey } from '@/utils/time';

export default function ExpenseForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { db } = useApp();
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayKey());
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void (async () => {
      setCategories(await listCategories(db));
      if (isNew) return;
      const e = await getExpense(db, Number(id));
      if (!e) return;
      setCategoryId(e.categoryId);
      setAmount(centsToInput(e.amountCents));
      setDate(e.spentDate);
      setDescription(e.description);
      setNotes(e.notes ?? '');
    })();
  }, [db, id, isNew]);

  if (!categories) return <Loading />;

  const save = async () => {
    if (categoryId === null) throw new ValidationError('Choose a category.');
    const input = { categoryId, amountCents: unwrap(parseMoneyToCents(amount)), spentDate: date, description, notes };
    if (isNew) await createExpense(db, input);
    else await updateExpense(db, Number(id), input);
  };

  return (
    <FormScreen title={isNew ? 'New Expense' : 'Edit Expense'} domain="money" onSave={save} onDelete={isNew ? undefined : () => deleteExpense(db, Number(id))} deleteLabel="Delete expense">
      <FormSection>
        <MoneyField label="Amount" value={amount} onChangeText={setAmount} />
        <TextField label="Description" value={description} onChangeText={setDescription} placeholder="e.g. Coles" maxLength={120} />
        <DateField label="Date" value={date} onChange={setDate} last />
      </FormSection>
      <FormSection title="Category">
        <ChoiceField options={categories.map((c) => ({ value: c.id, label: c.name, color: c.color }))} value={categoryId} onChange={setCategoryId} last />
      </FormSection>
      <FormSection title="Notes">
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional" maxLength={1000} last />
      </FormSection>
    </FormScreen>
  );
}
