import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { ChoiceField, DateField, FormSection, SwitchField, TextField, TimeField } from '@/components/form';
import { Button, Card, Divider, EmptyState, GradientTile, Icon, Loading, Row, Screen, Tag, Text } from '@/components/ui';
import { rosterNameList } from '@/database/repositories/settings';
import { listShiftsInRange, listWorkplaces, type Shift, type Workplace } from '@/database/repositories/work';
import { defaultWeekStart, parseRoster, type OcrLine, type RosterParseResult } from '@/features/work/rosterParse';
import { applyRoster, diffRoster, includedByDefault, type RosterChange, type RosterDraft } from '@/features/work/rosterSync';
import { computeShift } from '@/features/work/shiftMath';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { notifyNow } from '@/services/reminderSync';
import { pickRoster, readRoster, type PickedRoster, type RosterSource } from '@/services/rosterOcr';
import { radius, spacing } from '@/theme/tokens';
import { addDays, formatDateKey, formatTimeRange, startOfWeek, todayKey } from '@/utils/time';
import { parseIntInput } from '@/utils/validation';

type Phase = { kind: 'pick' } | { kind: 'reading'; file: PickedRoster } | { kind: 'review'; file: PickedRoster | null; lines: OcrLine[] };

const changeKey = (c: RosterChange) => (c.kind === 'removed' ? `rm-${c.existing.id}` : c.draft.key);
let draftSeq = 0;
const newKey = () => `d${++draftSeq}`;

/**
 * Upload Roster: photograph or choose a roster, read it on the iPhone, keep
 * only your shifts, then review/edit them before they're saved. A roster for
 * a week you've already imported updates it: moved shifts show what changed.
 */
export default function RosterImport() {
  const { db, settings, updateSetting, colors, notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const [workplaces, setWorkplaces] = useState<Workplace[] | null>(null);
  const [workplaceId, setWorkplaceId] = useState<number | null>(null);
  const [names, setNames] = useState(settings.rosterNames || settings.displayName.toUpperCase());
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [weekStart, setWeekStart] = useState(defaultWeekStart(todayKey()));
  const [parsed, setParsed] = useState<RosterParseResult | null>(null);
  const [drafts, setDrafts] = useState<RosterDraft[]>([]);
  const [existing, setExisting] = useState<Shift[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [breakMins, setBreakMins] = useState(String(settings.rosterBreakMinutes));
  const [showText, setShowText] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listWorkplaces(db).then((w) => {
      setWorkplaces(w);
      setWorkplaceId((id) => id ?? w[0]?.id ?? null);
    });
  }, [db]);

  // Shifts already saved at this workplace, to spot changes.
  useEffect(() => {
    if (workplaceId === null) return;
    const today = todayKey();
    void listShiftsInRange(db, { start: addDays(today, -130), end: addDays(today, 130) }).then((all) => setExisting(all.filter((s) => s.workplaceId === workplaceId)));
  }, [db, workplaceId]);

  const nameList = rosterNameList(names);

  const parse = (lines: OcrLine[], ws: string) => {
    const r = parseRoster(lines, { names: nameList, today: todayKey(), weekStart: ws });
    setParsed(r);
    setDrafts(r.shifts.map((s) => ({ ...s, key: newKey() })));
    setPicked({});
    setEditing(null);
    return r;
  };

  const start = async (source: RosterSource) => {
    if (nameList.length === 0) return Alert.alert('Add your name', 'Enter your name as it appears on the roster, so only your shifts are taken.');
    if (names !== settings.rosterNames) void updateSetting('rosterNames', names.trim());
    let file: PickedRoster | null;
    try {
      file = await pickRoster(source);
    } catch (e) {
      return Alert.alert('Couldn’t open the roster', e instanceof Error ? e.message : String(e));
    }
    if (!file) return;
    setPhase({ kind: 'reading', file });
    try {
      const lines = await readRoster(file.uri, nameList);
      const r = parse(lines, weekStart);
      haptic(r.shifts.length ? 'success' : 'warning');
      setPhase({ kind: 'review', file, lines });
    } catch (e) {
      setPhase({ kind: 'pick' });
      Alert.alert('Couldn’t read the roster', e instanceof Error ? e.message : String(e));
    }
  };

  const changes = useMemo(() => diffRoster(existing, drafts), [existing, drafts]);
  const isOn = (c: RosterChange) => picked[changeKey(c)] ?? (parsed?.nameFound === false && c.kind === 'new' ? sharedDates(drafts) === 0 : includedByDefault(c));
  const toggle = (c: RosterChange) => setPicked((p) => ({ ...p, [changeKey(c)]: !isOn(c) }));
  const chosen = changes.filter((c) => c.kind !== 'same' && isOn(c));
  const updateDraft = (key: string, patch: Partial<RosterDraft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const save = async () => {
    const w = workplaces?.find((x) => x.id === workplaceId);
    if (!w) return Alert.alert('Choose a workplace');
    const brk = parseIntInput(breakMins || '0', 'Unpaid break', 0, 120);
    if (!brk.ok) return Alert.alert('Check the break', brk.error);
    for (const c of chosen) {
      if (c.kind === 'removed') continue;
      const t = computeShift({ date: c.draft.date, startTime: c.draft.startTime, endTime: c.draft.endTime, unpaidBreakMinutes: brk.value, hourlyRateCents: w.defaultRateCents });
      if (!t.ok) return Alert.alert(`Check ${formatDateKey(c.draft.date, { weekday: true })}`, t.error);
    }
    setSaving(true);
    try {
      if (brk.value !== settings.rosterBreakMinutes) void updateSetting('rosterBreakMinutes', brk.value);
      const result = await applyRoster(db, chosen, { workplaceId: w.id, hourlyRateCents: w.defaultRateCents, unpaidBreakMinutes: brk.value });
      notifyDataChanged('work');
      haptic('success');
      if (result.changed + result.cancelled > 0) {
        await notifyNow(settings, 'Roster updated', result.lines.slice(0, 4).join('\n') + (result.lines.length > 4 ? `\n+${result.lines.length - 4} more` : '')).catch((e: unknown) => console.warn('Notify failed', e));
      }
      router.back();
      const parts = [result.added && `${result.added} added`, result.changed && `${result.changed} changed`, result.cancelled && `${result.cancelled} cancelled`].filter(Boolean);
      Alert.alert('Roster saved', parts.length ? `${parts.join(', ')}. Reminders are updated to match.` : 'Everything was already up to date.');
    } catch (e) {
      haptic('error');
      Alert.alert('Couldn’t save the roster', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!workplaces) return <Loading />;
  if (workplaces.length === 0) {
    return (
      <Screen largeTitle={false}>
        <Card>
          <EmptyState icon="building.2" title="Add your workplace first" message="Imported shifts use its pay rates." action="Add workplace" onAction={() => router.replace('/workplace/new')} />
        </Card>
      </Screen>
    );
  }

  const setup = (
    <>
      <FormSection title="Workplace" footer="Shifts are added here, at its pay rates.">
        <ChoiceField options={workplaces.map((w) => ({ value: w.id, label: w.name, color: w.color }))} value={workplaceId} onChange={setWorkplaceId} last />
      </FormSection>
      <FormSection title="Your name on the roster" footer="Only rows with this name are taken. Add variants separated by commas, e.g. HARIHARAN, Hari.">
        <TextField label="Name" value={names} onChangeText={setNames} autoCapitalize="characters" autoCorrect={false} placeholder="HARIHARAN" maxLength={200} last />
      </FormSection>
    </>
  );

  if (phase.kind === 'pick') {
    const sources: { source: RosterSource; icon: string; label: string }[] = [
      { source: 'camera', icon: 'camera', label: 'Take Photo' },
      { source: 'photos', icon: 'photo.on.rectangle', label: 'Choose from Photos' },
      { source: 'files', icon: 'doc', label: 'Import from Files (image or PDF)' },
    ];
    return (
      <Screen largeTitle={false}>
        <View style={[styles.drop, { borderColor: colors.accent }]}>
          <GradientTile icon="doc.text.viewfinder" tone="sky" size={56} />
          <Text variant="headline">Upload Your Roster</Text>
          <Text variant="subhead" tone="secondary" style={{ textAlign: 'center' }}>
            Take a photo, pick a screenshot or open a PDF. It’s read on this iPhone — nothing is uploaded — and only your shifts are kept.
          </Text>
        </View>
        <Card style={{ paddingVertical: spacing.xs }}>
          {sources.map((s, i) => (
            <View key={s.source}>
              {i > 0 ? <Divider /> : null}
              <Pressable accessibilityRole="button" onPress={() => void start(s.source)} style={({ pressed }) => [styles.source, { opacity: pressed ? 0.6 : 1 }]}>
                <Icon name={s.icon} color={colors.accent} />
                <Text variant="callout" style={{ flex: 1 }}>
                  {s.label}
                </Text>
                <Icon name="chevron.right" color={colors.textTertiary} size={12} />
              </Pressable>
            </View>
          ))}
        </Card>
        {setup}
        <Text variant="footnote" tone="tertiary">
          Tip: photograph the roster flat and in good light, with the day headings and your row in the frame.
        </Text>
      </Screen>
    );
  }

  if (phase.kind === 'reading') {
    return (
      <Screen largeTitle={false}>
        <Card style={{ alignItems: 'center', gap: spacing.md }}>
          {phase.file.previewUri ? <Image source={{ uri: phase.file.previewUri }} style={styles.preview} resizeMode="contain" /> : <Icon name="doc.richtext" size={44} color={colors.accent} />}
          <ActivityIndicator color={colors.accent} />
          <Text variant="subhead" tone="secondary">
            Reading your roster on this iPhone…
          </Text>
        </Card>
      </Screen>
    );
  }

  const r = parsed!;
  const counts = { new: 0, changed: 0, same: 0, removed: 0 };
  for (const c of changes) counts[c.kind]++;
  const tag = {
    new: { label: 'New', color: colors.success },
    changed: { label: 'Changed', color: colors.warning },
    same: { label: 'No change', color: colors.textTertiary },
    removed: { label: 'Not on roster', color: colors.danger },
  } as const;

  return (
    <Screen largeTitle={false}>
      {phase.file?.previewUri ? <Image source={{ uri: phase.file.previewUri }} style={styles.thumb} resizeMode="cover" accessibilityLabel="Roster image" /> : null}

      <Card>
        <Row>
          <Icon name={r.shifts.length && r.nameFound ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'} color={r.shifts.length && r.nameFound ? colors.success : colors.warning} size={26} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">
              {r.shifts.length === 0 ? 'No shifts found' : `${r.shifts.length} ${r.shifts.length === 1 ? 'shift' : 'shifts'} found${r.nameFound ? ` for ${nameList[0]}` : ''}`}
            </Text>
            <Text variant="footnote" tone="secondary">
              {r.shifts.length === 0
                ? r.nameFound
                  ? 'Your name was found, but no times next to it. Try a clearer photo, or add shifts below.'
                  : `“${nameList.join('”, “')}” wasn’t found. Check how your name is written on the roster, or try a clearer photo.`
                : r.nameFound
                  ? 'Check them below — tap a shift to edit it.'
                  : 'Your name wasn’t on it, so this looks like a personal roster. Untick any that aren’t yours.'}
            </Text>
          </View>
        </Row>
      </Card>

      {r.usedWeekStart ? (
        <FormSection title="Roster week" footer="This roster only shows weekdays, so pick the week it’s for.">
          <DateField
            label="Week starting"
            value={weekStart}
            onChange={(v) => {
              const monday = startOfWeek(v, 1);
              setWeekStart(monday);
              parse(phase.lines, monday);
            }}
            last
          />
        </FormSection>
      ) : null}

      {changes.length > 0 ? (
        <Card style={{ paddingVertical: spacing.xs }}>
          {changes.map((c, i) => {
            const k = changeKey(c);
            const on = c.kind === 'same' ? true : isOn(c);
            const draft = c.kind === 'removed' ? null : c.draft;
            const times = draft ? computeShift({ date: draft.date, startTime: draft.startTime, endTime: draft.endTime, unpaidBreakMinutes: 0, hourlyRateCents: 0 }) : null;
            const date = c.kind === 'removed' ? c.existing.shiftDate : c.draft.date;
            const label =
              c.kind === 'removed'
                ? formatTimeRange(c.existing.startAt, c.existing.endAt)
                : times?.ok
                  ? formatTimeRange(times.value.startAt, times.value.endAt)
                  : `${c.draft.startTime}–${c.draft.endTime}`;
            return (
              <View key={k}>
                {i > 0 ? <Divider /> : null}
                <Row style={styles.change}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: c.kind === 'same' }}
                    accessibilityLabel={`${c.kind === 'removed' ? 'Cancel' : 'Save'} ${formatDateKey(date, { weekday: true })} ${label}`}
                    disabled={c.kind === 'same'}
                    onPress={() => toggle(c)}
                    hitSlop={10}
                  >
                    <Icon name={on ? 'checkmark.circle.fill' : 'circle'} color={c.kind === 'same' ? colors.textTertiary : on ? colors.accent : colors.textTertiary} size={24} />
                  </Pressable>
                  <Pressable style={{ flex: 1, gap: 2 }} disabled={!draft} onPress={() => setEditing(editing === k ? null : k)} accessibilityRole="button" accessibilityHint="Edit this shift">
                    <Text variant="callout" style={{ fontWeight: '600', textDecorationLine: c.kind === 'removed' && on ? 'line-through' : 'none' }}>
                      {formatDateKey(date, { weekday: true })}
                    </Text>
                    <Text variant="subhead" tone="secondary">
                      {label}
                    </Text>
                    {c.kind === 'changed' ? (
                      <Text variant="caption" tone="warning">
                        was {formatTimeRange(c.existing.startAt, c.existing.endAt)}
                      </Text>
                    ) : null}
                    {c.kind === 'removed' ? (
                      <Text variant="caption" tone="tertiary">
                        {on ? 'Will be cancelled' : 'Kept'} · {c.existing.source === 'roster' ? 'from an earlier roster' : 'added by you'}
                      </Text>
                    ) : null}
                    {times && !times.ok ? (
                      <Text variant="caption" tone="danger">
                        {times.error}
                      </Text>
                    ) : null}
                  </Pressable>
                  <Tag label={tag[c.kind].label} color={tag[c.kind].color} />
                  {draft ? <Icon name="pencil" color={colors.textTertiary} size={14} /> : null}
                </Row>
                {draft && editing === k ? (
                  <View style={[styles.editor, { backgroundColor: colors.surface }]}>
                    <DateField label="Date" value={draft.date} onChange={(v) => updateDraft(draft.key, { date: v })} />
                    <TimeField label="Start" value={draft.startTime} onChange={(v) => updateDraft(draft.key, { startTime: v })} />
                    <TimeField label="Finish" value={draft.endTime} onChange={(v) => updateDraft(draft.key, { endTime: v })} last />
                    {draft.source ? (
                      <Text variant="caption" tone="tertiary">
                        Read as “{draft.source}”
                      </Text>
                    ) : null}
                    <Row>
                      <Button title="Remove" kind="plain" icon="trash" onPress={() => setDrafts((ds) => ds.filter((d) => d.key !== draft.key))} style={{ flex: 1 }} />
                      <Button title="Done" kind="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                    </Row>
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      <Button
        title="Add a shift manually"
        kind="plain"
        icon="plus"
        onPress={() => {
          const key = newKey();
          const last = drafts[drafts.length - 1];
          setDrafts((ds) => [...ds, { key, date: last ? addDays(last.date, 1) : weekStart, startTime: last?.startTime ?? '09:00', endTime: last?.endTime ?? '17:00', source: '' }]);
          setEditing(key);
        }}
      />

      {setup}
      <FormSection title="Pay" footer="Unpaid break added to each new shift from this roster.">
        <TextField label="Unpaid break" value={breakMins} onChangeText={setBreakMins} keyboardType="number-pad" placeholder="minutes" maxLength={3} last />
      </FormSection>

      <FormSection>
        <SwitchField label="Show what was read" value={showText} onChange={setShowText} last />
      </FormSection>
      {showText ? (
        <Card>
          <Text variant="caption" style={{ fontFamily: 'Menlo' }} selectable>
            {r.text || '(no text found)'}
          </Text>
        </Card>
      ) : null}

      <Button
        title={chosen.length === 0 ? 'Nothing to save' : counts.changed + counts.removed > 0 ? `Save ${chosen.length} ${chosen.length === 1 ? 'change' : 'changes'}` : `Add ${chosen.length} to My Shifts`}
        icon="checkmark"
        disabled={chosen.length === 0}
        loading={saving}
        onPress={() => void save()}
      />
      <Button title="Use a different photo" kind="plain" icon="arrow.counterclockwise" onPress={() => setPhase({ kind: 'pick' })} />
    </Screen>
  );
}

/** How many dates have more than one shift — a sign the roster is everyone's, not just yours. */
function sharedDates(drafts: RosterDraft[]): number {
  const seen = new Map<string, number>();
  for (const d of drafts) seen.set(d.date, (seen.get(d.date) ?? 0) + 1);
  return [...seen.values()].filter((n) => n > 1).length;
}

const styles = StyleSheet.create({
  drop: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.lg },
  source: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
  preview: { width: '100%', height: 220, borderRadius: radius.md },
  thumb: { width: '100%', height: 160, borderRadius: radius.md },
  change: { paddingVertical: spacing.md, gap: spacing.md },
  editor: { borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, gap: spacing.xs },
});
