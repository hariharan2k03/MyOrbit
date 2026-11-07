import DateTimePicker from '@react-native-community/datetimepicker';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp, type DataDomain } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { radius, spacing, SWATCHES } from '@/theme/tokens';
import { ValidationError } from '@/utils/result';
import { formatMinutesAsTime, parseTime, toDateKey, dateFromKey, type DateKey } from '@/utils/time';
import { Button, Chip, Icon, Text } from './ui';

/**
 * Form shell: native header with Cancel/Save, keyboard avoidance and safe
 * areas. `onSave` may throw ValidationError to show its message to the user.
 */
export function FormScreen({
  title,
  onSave,
  domain,
  children,
  onDelete,
  deleteLabel = 'Delete',
}: {
  title: string;
  onSave: () => Promise<void>;
  domain: DataDomain;
  children: ReactNode;
  onDelete?: () => Promise<void>;
  deleteLabel?: string;
}) {
  const { colors } = useApp();
  const insets = useSafeAreaInsets();
  const save = useSaveAction(onSave, domain);
  const remove = useSaveAction(onDelete ?? (async () => undefined), domain);

  const confirmDelete = () =>
    Alert.alert(`${deleteLabel}?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: deleteLabel, style: 'destructive', onPress: () => void remove.run() },
    ]);

  // Header options only change with the title or busy state. Rebuilding them on every
  // keystroke pushed a native header update per character and backed up the JS
  // thread, so text events reached state seconds late (B-008).
  const { run: saveRun, busy: saveBusy } = save;
  const options = useMemo(
    () => ({
      title,
      headerLeft: () => (
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text color={colors.text} style={{ paddingHorizontal: 4 }}>
            Cancel
          </Text>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable accessibilityRole="button" onPress={() => void saveRun()} disabled={saveBusy} hitSlop={10}>
          <Text variant="headline" color={colors.text} style={{ paddingHorizontal: 4, opacity: saveBusy ? 0.4 : 1 }}>
            Save
          </Text>
        </Pressable>
      ),
    }),
    [title, saveRun, saveBusy, colors.text],
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={options} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
      >
        {children}
        {onDelete ? <Button title={deleteLabel} kind="danger" onPress={confirmDelete} loading={remove.busy} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Resolved by TextField once its end-editing event (carrying the final text) is handled. */
let endEditingWaiters: (() => void)[] = [];

function notifyEndEditing() {
  const waiters = endEditingWaiters;
  endEditingWaiters = [];
  waiters.forEach((resolve) => resolve());
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Ends editing on the focused field and waits until its end-editing event has been
 * handled (events arrive in order, so every earlier keystroke has been too), then
 * one more frame for React to commit and refresh the save callback (B-008).
 */
async function commitPendingInput(): Promise<void> {
  const focused = TextInput.State.currentlyFocusedInput();
  if (!focused) return;
  const ended = new Promise<void>((resolve) => endEditingWaiters.push(resolve));
  TextInput.State.blurTextInput(focused);
  // A field that isn't a TextField never signals; don't hang the save on it.
  await Promise.race([ended, new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
  await nextFrame();
  await nextFrame();
}

/**
 * Runs a mutation, surfaces validation errors, notifies listeners and closes the screen.
 * `run` always calls the latest `fn`: native header buttons can hold on to an older
 * `run`, so reading `fn` from the closure would save stale form values when Save is
 * tapped straight after typing (B-007).
 */
export function useSaveAction(fn: () => Promise<void>, domain: DataDomain, opts: { close?: boolean } = {}) {
  const { notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const [busy, setBusy] = useState(false);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const busyRef = useRef(false);
  const close = opts.close ?? true;
  const run = useCallback(async () => {
    if (busyRef.current) return; // ignore double taps while a save is running
    busyRef.current = true;
    setBusy(true);
    try {
      await commitPendingInput();
      await fnRef.current();
      notifyDataChanged(domain);
      haptic('success');
      if (close) router.back();
    } catch (e) {
      haptic('error');
      if (e instanceof ValidationError) Alert.alert('Check your details', e.message);
      else {
        console.error('Save failed', e);
        Alert.alert('Could not save', 'An unexpected error occurred. Your data was not changed.');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [domain, notifyDataChanged, haptic, close]);
  return { run, busy };
}

export function FormSection({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const { colors } = useApp();
  return (
    <View style={{ gap: spacing.xs }}>
      {title ? (
        <Text variant="footnote" tone="secondary" style={styles.sectionTitle}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
      {footer ? (
        <Text variant="footnote" tone="tertiary" style={{ paddingHorizontal: spacing.lg }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

function FieldRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  const { colors } = useApp();
  return (
    <View style={[styles.field, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text variant="callout" style={{ minWidth: 96 }}>
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{children}</View>
    </View>
  );
}

export function TextField({ label, last, onEndEditing, ...props }: TextInputProps & { label: string; last?: boolean }) {
  const { colors } = useApp();
  return (
    <FieldRow label={label} last={last}>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, { color: colors.text }, props.multiline && { minHeight: 60, textAlignVertical: 'top' }]}
        textAlign="right"
        {...props}
        // Change events reach JS asynchronously; the end-of-editing event carries the
        // field's final native text, so state is authoritative before a save runs (B-008).
        onEndEditing={(e) => {
          if (e.nativeEvent.text !== props.value) props.onChangeText?.(e.nativeEvent.text);
          onEndEditing?.(e);
          notifyEndEditing();
        }}
      />
    </FieldRow>
  );
}

export function MoneyField({ label, value, onChangeText, last }: { label: string; value: string; onChangeText: (v: string) => void; last?: boolean }) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={(v) => onChangeText(v.replace(/[^0-9.,$]/g, ''))}
      keyboardType="decimal-pad"
      placeholder="$0.00"
      maxLength={14}
      last={last}
    />
  );
}

export function DateField({ label, value, onChange, last }: { label: string; value: DateKey; onChange: (v: DateKey) => void; last?: boolean }) {
  const { isDark } = useApp();
  return (
    <FieldRow label={label} last={last}>
      <DateTimePicker
        accessibilityLabel={label}
        value={dateFromKey(value)}
        mode="date"
        display="compact"
        themeVariant={isDark ? 'dark' : 'light'}
        onValueChange={(_, d) => onChange(toDateKey(d))}
      />
    </FieldRow>
  );
}

/** Time stored as `HH:mm`; the picker works on a Date in local time. */
export function TimeField({ label, value, onChange, last }: { label: string; value: string; onChange: (v: string) => void; last?: boolean }) {
  const { isDark } = useApp();
  const minutes = parseTime(value);
  const d = new Date(2000, 0, 1, 0, minutes.ok ? minutes.value : 540);
  return (
    <FieldRow label={label} last={last}>
      <DateTimePicker
        accessibilityLabel={label}
        value={d}
        mode="time"
        display="compact"
        minuteInterval={5}
        themeVariant={isDark ? 'dark' : 'light'}
        onValueChange={(_, t) => onChange(formatMinutesAsTime(t.getHours() * 60 + t.getMinutes()))}
      />
    </FieldRow>
  );
}

export function SwitchField({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const { colors } = useApp();
  const haptic = useHaptics();
  // Label takes the free space and the switch sits last, as in iOS Settings. Wrapping the
  // switch in an alignItems:'flex-end' box left it mid-row with the wider iOS 26 switch.
  return (
    <View style={[styles.field, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text variant="callout" style={{ flex: 1 }}>
        {label}
      </Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        trackColor={{ true: colors.accent }}
        onValueChange={(v) => {
          haptic('select');
          onChange(v);
        }}
      />
    </View>
  );
}

export function ChoiceField<T extends string | number>({
  label,
  options,
  value,
  onChange,
  last,
}: {
  label?: string;
  options: readonly { value: T; label: string; color?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  last?: boolean;
}) {
  const { colors } = useApp();
  return (
    <View style={[styles.choice, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      {label ? <Text variant="callout">{label}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {options.map((o) => (
          <Chip key={String(o.value)} label={o.label} color={o.color} selected={o.value === value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );
}

const SWATCH_NAMES = ['Purple', 'Blue', 'Green', 'Orange', 'Teal', 'Pink', 'Yellow', 'Grey'];

/** Colour swatches: always filled; the selected one gets a ring and a tick. */
export function ColorField({ value, onChange, last }: { value: string; onChange: (c: string) => void; last?: boolean }) {
  const { colors } = useApp();
  const haptic = useHaptics();
  return (
    <View style={[styles.choice, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {SWATCHES.map((c, i) => {
          const selected = c.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityLabel={SWATCH_NAMES[i] ?? c}
              accessibilityState={{ selected }}
              hitSlop={4}
              onPress={() => {
                haptic('select');
                onChange(c);
              }}
              style={[styles.swatchRing, { borderColor: selected ? colors.text : 'transparent' }]}
            >
              <View style={[styles.swatch, { backgroundColor: c }]}>{selected ? <Icon name="checkmark" color="#FFFFFF" size={16} /> : null}</View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors } = useApp();
  const haptic = useHaptics();
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              haptic('select');
              onChange(o.value);
            }}
            style={[styles.segment, selected && { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }]}
          >
            <Text variant="subhead" color={selected ? colors.onAccent : colors.textSecondary} style={{ fontWeight: selected ? '600' : '500' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: spacing.lg },
  group: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.lg, gap: spacing.md },
  input: { fontSize: 17, paddingVertical: spacing.md, width: '100%' },
  choice: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  swatchRing: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  // Pill tabs: selected segment is a filled accent pill inside a translucent track.
  segmented: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, borderWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.pill },
});
