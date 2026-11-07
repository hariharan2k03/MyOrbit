import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ChoiceField, DateField, FormScreen, FormSection, MoneyField, TextField, TimeField } from '@/components/form';
import { Button, Card, EmptyState, Loading, Row, Stat, Text } from '@/components/ui';
import { createShift, deleteShift, getShift, listWorkplaces, updateShift, type Workplace } from '@/database/repositories/work';
import { baseOnly, PAY_KIND_LABEL, shiftPay, type PayRates } from '@/features/work/payRates';
import { computeShift } from '@/features/work/shiftMath';
import { useApp } from '@/services/AppContext';
import { formatCents, centsToInput, parseMoneyToCents } from '@/utils/money';
import { unwrap, ValidationError } from '@/utils/result';
import { formatDuration, toTimeValue, todayKey } from '@/utils/time';
import { parseIntInput } from '@/utils/validation';

export default function ShiftForm() {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const isNew = id === 'new';
  const { db } = useApp();
  const [workplaces, setWorkplaces] = useState<Workplace[] | null>(null);
  const [workplaceId, setWorkplaceId] = useState<number | null>(null);
  const [day, setDay] = useState(date ?? todayKey());
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [breakMins, setBreakMins] = useState('30');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void (async () => {
      const wps = await listWorkplaces(db);
      setWorkplaces(wps);
      if (!isNew) {
        const s = await getShift(db, Number(id));
        if (!s) return;
        setWorkplaceId(s.workplaceId);
        setDay(s.shiftDate);
        setStart(toTimeValue(s.startAt));
        setEnd(toTimeValue(s.endAt));
        setBreakMins(String(s.unpaidBreakMinutes));
        setRate(centsToInput(s.hourlyRateCents));
        setNotes(s.notes ?? '');
      } else if (wps[0]) {
        setWorkplaceId(wps[0].id);
        setRate(centsToInput(wps[0].defaultRateCents));
      }
    })();
  }, [db, id, isNew]);

  const preview = useMemo(() => {
    const r = parseMoneyToCents(rate, { allowZero: true });
    const b = parseIntInput(breakMins || '0', 'Break', 0, 600);
    if (!r.ok || !b.ok) return null;
    const c = computeShift({ date: day, startTime: start, endTime: end, unpaidBreakMinutes: b.value, hourlyRateCents: r.value });
    if (!c.ok) return c;
    // Penalty rates come from the selected workplace; the base rate from this form.
    const w = workplaces?.find((x) => x.id === workplaceId);
    const rates: PayRates = {
      ...baseOnly(r.value),
      ...(w
        ? {
            saturdayCents: w.saturdayRateCents,
            sundayCents: w.sundayRateCents,
            nightCents: w.nightRateCents,
            nightStartMin: w.nightStartMin,
            nightEndMin: w.nightEndMin,
          }
        : null),
    };
    return { ok: true as const, value: { ...c.value, pay: shiftPay({ ...c.value, unpaidBreakMinutes: b.value }, rates) } };
  }, [day, start, end, breakMins, rate, workplaces, workplaceId]);

  if (!workplaces) return <Loading />;
  if (workplaces.length === 0) {
    return (
      <Card style={{ margin: 16 }}>
        <EmptyState icon="building.2" title="Add a workplace first" message="Shifts belong to a workplace with an hourly rate." />
        <Button title="Add workplace" onPress={() => router.replace('/workplace/new')} />
      </Card>
    );
  }

  const save = async () => {
    if (workplaceId === null) throw new ValidationError('Choose a workplace.');
    const input = {
      workplaceId,
      date: day,
      startTime: start,
      endTime: end,
      unpaidBreakMinutes: unwrap(parseIntInput(breakMins || '0', 'Unpaid break', 0, 600)),
      hourlyRateCents: unwrap(parseMoneyToCents(rate, { allowZero: true })),
      notes,
    };
    if (isNew) await createShift(db, input);
    else await updateShift(db, Number(id), input);
  };

  return (
    <FormScreen
      title={isNew ? 'New Shift' : 'Edit Shift'}
      domain="work"
      onSave={save}
      onDelete={isNew ? undefined : () => deleteShift(db, Number(id))}
      deleteLabel="Delete shift"
    >
      <FormSection title="Workplace">
        <ChoiceField
          options={workplaces.map((w) => ({ value: w.id, label: w.name, color: w.color }))}
          value={workplaceId}
          onChange={(v) => {
            setWorkplaceId(v);
            const w = workplaces.find((x) => x.id === v);
            if (w && isNew) setRate(centsToInput(w.defaultRateCents));
          }}
          last
        />
      </FormSection>
      <FormSection title="Time" footer="A finish time earlier than the start means the shift ends the next day.">
        <DateField label="Date" value={day} onChange={setDay} />
        <TimeField label="Start" value={start} onChange={setStart} />
        <TimeField label="Finish" value={end} onChange={setEnd} />
        <TextField label="Unpaid break" value={breakMins} onChangeText={setBreakMins} keyboardType="number-pad" placeholder="minutes" maxLength={3} last />
      </FormSection>
      <FormSection title="Pay">
        <MoneyField label="Base rate" value={rate} onChangeText={setRate} last />
      </FormSection>
      <FormSection title="Notes">
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={1000} placeholder="Optional" last />
      </FormSection>
      {preview ? (
        <Card>
          {preview.ok ? (
            <>
              <Row align="start">
                <Stat label="Paid" value={formatDuration(preview.value.paidMinutes)} hint={preview.value.overnight ? 'Overnight' : undefined} />
                <Stat label="Gross pay" value={formatCents(preview.value.pay.grossCents)} hint="before tax" />
              </Row>
              {preview.value.pay.segments.length > 1 || preview.value.pay.segments[0]?.kind !== 'base'
                ? preview.value.pay.segments.map((s) => (
                    <Row key={s.kind}>
                      <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
                        {PAY_KIND_LABEL[s.kind]} · {formatDuration(s.minutes)} × {formatCents(s.rateCents)}/h
                      </Text>
                      <Text variant="footnote">{formatCents(s.cents)}</Text>
                    </Row>
                  ))
                : null}
            </>
          ) : (
            <Text tone="danger">{preview.error}</Text>
          )}
        </Card>
      ) : null}
    </FormScreen>
  );
}
