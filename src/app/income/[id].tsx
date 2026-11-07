import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ChoiceField, DateField, FormScreen, FormSection, MoneyField, TextField } from '@/components/form';
import { createIncome, deleteIncome, getIncome, INCOME_CATEGORIES, updateIncome, type IncomeCategory } from '@/database/repositories/finance';
import { listWorkplaces, type Workplace } from '@/database/repositories/work';
import { useApp } from '@/services/AppContext';
import { centsToInput, parseMoneyToCents } from '@/utils/money';
import { unwrap } from '@/utils/result';
import { todayKey } from '@/utils/time';

const label = (c: string) => c[0]!.toUpperCase() + c.slice(1);

export default function IncomeForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { db } = useApp();
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(todayKey());
  const [category, setCategory] = useState<IncomeCategory>('wages');
  const [source, setSource] = useState('');
  const [workplaceId, setWorkplaceId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void (async () => {
      setWorkplaces(await listWorkplaces(db));
      if (isNew) return;
      const i = await getIncome(db, Number(id));
      if (!i) return;
      setAmount(centsToInput(i.amountCents));
      setPayDate(i.payDate);
      setCategory(i.category);
      setSource(i.source);
      setWorkplaceId(i.workplaceId);
      setNotes(i.notes ?? '');
    })();
  }, [db, id, isNew]);

  const save = async () => {
    const input = { amountCents: unwrap(parseMoneyToCents(amount)), payDate, category, source, workplaceId, notes };
    if (isNew) await createIncome(db, input);
    else await updateIncome(db, Number(id), input);
  };

  return (
    <FormScreen title={isNew ? 'New Income' : 'Edit Income'} domain="money" onSave={save} onDelete={isNew ? undefined : () => deleteIncome(db, Number(id))} deleteLabel="Delete income">
      <FormSection footer="Record the amount actually paid into your account. This is kept separate from estimated shift earnings.">
        <MoneyField label="Amount" value={amount} onChangeText={setAmount} />
        <TextField label="Source" value={source} onChangeText={setSource} placeholder="e.g. Fortnightly pay" maxLength={120} />
        <DateField label="Pay date" value={payDate} onChange={setPayDate} last />
      </FormSection>
      <FormSection title="Category">
        <ChoiceField options={INCOME_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} value={category} onChange={setCategory} last />
      </FormSection>
      {workplaces.length > 0 ? (
        <FormSection title="Workplace (optional)">
          <ChoiceField
            options={[{ value: 0, label: 'None' }, ...workplaces.map((w) => ({ value: w.id, label: w.name, color: w.color }))]}
            value={workplaceId ?? 0}
            onChange={(v) => {
              setWorkplaceId(v === 0 ? null : v);
              const w = workplaces.find((x) => x.id === v);
              if (w && !source.trim()) setSource(`${w.name} pay`);
            }}
            last
          />
        </FormSection>
      ) : null}
      <FormSection title="Notes">
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional" maxLength={1000} last />
      </FormSection>
    </FormScreen>
  );
}
