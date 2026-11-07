import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FormScreen, FormSection, MoneyField, TextField } from '@/components/form';
import { Loading } from '@/components/ui';
import { deleteBudget, listBudgets, listCategories, setBudget, type Budget, type ExpenseCategory } from '@/database/repositories/finance';
import { useApp } from '@/services/AppContext';
import { centsToInput, parseMoneyToCents } from '@/utils/money';
import { unwrap } from '@/utils/result';
import { parseIntInput } from '@/utils/validation';

/**
 * `/budget/overall` edits the monthly budget and its start day.
 * `/budget/categories` edits per-category limits; a blank field removes that limit.
 * Budgets only change when the user taps Save.
 */
export default function BudgetForm() {
  const { id } = useLocalSearchParams<{ id: 'overall' | 'categories' }>();
  const { db } = useApp();
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [overall, setOverall] = useState('');
  const [startDay, setStartDay] = useState('1');
  const [perCat, setPerCat] = useState<Record<number, string>>({});

  useEffect(() => {
    void (async () => {
      const [b, c] = await Promise.all([listBudgets(db), listCategories(db)]);
      setBudgets(b);
      setCategories(c);
      const o = b.find((x) => x.categoryId === null);
      if (o) {
        setOverall(centsToInput(o.limitCents));
        setStartDay(String(o.periodStartDay));
      }
      setPerCat(Object.fromEntries(b.filter((x) => x.categoryId !== null).map((x) => [x.categoryId!, centsToInput(x.limitCents)])));
    })();
  }, [db]);

  if (!budgets) return <Loading />;
  const existingOverall = budgets.find((b) => b.categoryId === null);

  if (id === 'categories') {
    const save = async () => {
      // Validate everything first so a bad field leaves all budgets unchanged.
      const parsed = categories.map((c) => {
        const raw = (perCat[c.id] ?? '').trim();
        return { c, cents: raw ? unwrap(parseMoneyToCents(raw)) : null };
      });
      // setBudget runs its own transaction (expo-sqlite can't nest them), so apply row by row.
      for (const { c, cents } of parsed) {
        const existing = budgets.find((b) => b.categoryId === c.id);
        if (cents === null) {
          if (existing) await deleteBudget(db, existing.id);
        } else await setBudget(db, c.id, cents, existingOverall?.periodStartDay ?? 1);
      }
    };
    return (
      <FormScreen title="Category Budgets" domain="money" onSave={save}>
        <FormSection footer="Leave blank for no limit. Category budgets use the same period as your overall budget.">
          {categories.map((c, i) => (
            <MoneyField key={c.id} label={c.name} value={perCat[c.id] ?? ''} onChangeText={(v) => setPerCat((p) => ({ ...p, [c.id]: v }))} last={i === categories.length - 1} />
          ))}
        </FormSection>
      </FormScreen>
    );
  }

  const save = async () => {
    await setBudget(db, null, unwrap(parseMoneyToCents(overall)), unwrap(parseIntInput(startDay, 'Start day', 1, 28)));
  };
  return (
    <FormScreen
      title="Monthly Budget"
      domain="money"
      onSave={save}
      onDelete={existingOverall ? () => deleteBudget(db, existingOverall.id) : undefined}
      deleteLabel="Remove budget"
    >
      <FormSection footer="Pick the day your budget period starts, e.g. your payday. Must be 1–28 so every month has it.">
        <MoneyField label="Budget" value={overall} onChangeText={setOverall} />
        <TextField label="Starts on day" value={startDay} onChangeText={setStartDay} keyboardType="number-pad" maxLength={2} last />
      </FormSection>
    </FormScreen>
  );
}
