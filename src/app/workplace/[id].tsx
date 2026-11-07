import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ColorField, FormScreen, FormSection, MoneyField, SwitchField, TextField, TimeField } from '@/components/form';
import { createWorkplace, listWorkplaces, removeWorkplace, updateWorkplace } from '@/database/repositories/work';
import { useApp } from '@/services/AppContext';
import { SWATCHES } from '@/theme/tokens';
import { centsToInput, parseMoneyToCents } from '@/utils/money';
import { unwrap } from '@/utils/result';
import { formatMinutesAsTime, parseTime } from '@/utils/time';

/** Blank → no penalty; otherwise a validated hourly amount. */
function optionalRate(input: string): number | null {
  return input.trim() ? unwrap(parseMoneyToCents(input)) : null;
}

export default function WorkplaceForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { db } = useApp();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState<string>(SWATCHES[0]);
  const [saturday, setSaturday] = useState('');
  const [sunday, setSunday] = useState('');
  const [nightOn, setNightOn] = useState(false);
  const [night, setNight] = useState('');
  const [nightStart, setNightStart] = useState('19:00');
  const [nightEnd, setNightEnd] = useState('07:00');

  useEffect(() => {
    if (isNew) return;
    void listWorkplaces(db, { includeArchived: true }).then((all) => {
      const w = all.find((x) => x.id === Number(id));
      if (!w) return;
      setName(w.name);
      setRate(centsToInput(w.defaultRateCents));
      setAddress(w.address ?? '');
      setNotes(w.notes ?? '');
      setColor(w.color);
      setSaturday(w.saturdayRateCents === null ? '' : centsToInput(w.saturdayRateCents));
      setSunday(w.sundayRateCents === null ? '' : centsToInput(w.sundayRateCents));
      setNightOn(w.nightRateCents !== null);
      if (w.nightRateCents !== null) setNight(centsToInput(w.nightRateCents));
      if (w.nightStartMin !== null) setNightStart(formatMinutesAsTime(w.nightStartMin));
      if (w.nightEndMin !== null) setNightEnd(formatMinutesAsTime(w.nightEndMin));
    });
  }, [db, id, isNew]);

  const save = async () => {
    const input = {
      name,
      defaultRateCents: unwrap(parseMoneyToCents(rate, { allowZero: true })),
      address,
      notes,
      color,
      saturdayRateCents: optionalRate(saturday),
      sundayRateCents: optionalRate(sunday),
      nightRateCents: nightOn ? unwrap(parseMoneyToCents(night)) : null,
      nightStartMin: nightOn ? unwrap(parseTime(nightStart)) : null,
      nightEndMin: nightOn ? unwrap(parseTime(nightEnd)) : null,
    };
    if (isNew) await createWorkplace(db, input);
    else await updateWorkplace(db, Number(id), input);
  };

  return (
    <FormScreen
      title={isNew ? 'New Workplace' : 'Edit Workplace'}
      domain="work"
      onSave={save}
      onDelete={isNew ? undefined : async () => void (await removeWorkplace(db, Number(id)))}
      deleteLabel="Remove workplace"
    >
      <FormSection footer="Workplaces with past shifts are archived rather than deleted, so your history and earnings stay intact.">
        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Cafe Nero" maxLength={80} autoFocus={isNew} />
        <MoneyField label="Base rate" value={rate} onChangeText={setRate} />
        <TextField label="Address" value={address} onChangeText={setAddress} placeholder="Optional" maxLength={120} />
        <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline maxLength={1000} last />
      </FormSection>

      <FormSection
        title="Penalty rates (per hour)"
        footer="Enter the hourly amount from your award or payslip, e.g. Saturday 125% of $30 = 37.50. Leave blank if it doesn’t apply. Each minute is paid at the highest rate that applies."
      >
        <MoneyField label="Saturday" value={saturday} onChangeText={setSaturday} />
        <MoneyField label="Sunday" value={sunday} onChangeText={setSunday} />
        <SwitchField label="Night rate" value={nightOn} onChange={setNightOn} last={!nightOn} />
        {nightOn ? (
          <>
            <MoneyField label="Night rate" value={night} onChangeText={setNight} />
            <TimeField label="Night starts" value={nightStart} onChange={setNightStart} />
            <TimeField label="Night ends" value={nightEnd} onChange={setNightEnd} last />
          </>
        ) : null}
      </FormSection>

      <FormSection title="Colour">
        <ColorField value={color} onChange={setColor} last />
      </FormSection>
    </FormScreen>
  );
}
