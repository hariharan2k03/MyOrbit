import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Card, Chip, GradientTile, Icon, Row, Screen, Text } from '@/components/ui';
import { listCategories } from '@/database/repositories/finance';
import { listWorkplaces } from '@/database/repositories/work';
import { ASSISTANT_INSTRUCTIONS, buildFacts } from '@/features/ai/aiFacts';
import { describeDraft, quickAddInstructions, resolveDraft, saveDraft, type QuickAddDraft } from '@/features/ai/quickAdd';
import { AI_UNAVAILABLE_MESSAGE, askAI, parseQuickAdd, useAIAvailability } from '@/services/ai';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { radius, spacing } from '@/theme/tokens';
import { ValidationError } from '@/utils/result';
import { todayKey } from '@/utils/time';

const SUGGESTIONS: { label: string; prompt: string }[] = [
  { label: 'Summarise my day', prompt: 'Give me a short summary of today: what’s on, what’s due, and one helpful tip.' },
  { label: 'Plan my study', prompt: 'Suggest 2–3 specific times to study today and tomorrow, using only my free time blocks, and say which assessment to work on first (the one due soonest).' },
  { label: 'Spending insights', prompt: 'Give me 2–3 short insights about my spending this month, compared with my budget and last month.' },
  { label: 'Earnings this month', prompt: 'How much have I earned from work this month, before and after tax?' },
  { label: 'Due this week', prompt: 'What assessments and tasks are due this week?' },
];

type Message = { id: number; role: 'user' | 'ai'; text: string; error?: boolean };

/**
 * Personal AI on Apple's on-device model. Every answer is grounded in facts
 * MyOrbit computes from your data; nothing leaves the iPhone.
 */
export default function AssistantScreen() {
  const { db, settings, colors, notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const availability = useAIAvailability();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [thinking, setThinking] = useState(false);
  const [quick, setQuick] = useState('');
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<QuickAddDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const nextId = useRef(1);

  if (availability !== 'available') {
    return (
      <Screen largeTitle={false}>
        <Card>
          <Row>
            <GradientTile icon="sparkles" tone="accent" size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">Personal AI isn’t available</Text>
              <Text variant="footnote" tone="secondary">
                {AI_UNAVAILABLE_MESSAGE[availability]}
              </Text>
            </View>
          </Row>
        </Card>
      </Screen>
    );
  }

  const ask = async (prompt: string, shown = prompt) => {
    if (thinking || !prompt.trim()) return;
    const userMsg: Message = { id: nextId.current++, role: 'user', text: shown };
    setMessages((m) => [...m, userMsg]);
    setQuestion('');
    setThinking(true);
    try {
      const facts = await buildFacts(db, settings);
      const answer = await askAI(`${ASSISTANT_INSTRUCTIONS}\n\nFACTS\n${facts}`, prompt.trim());
      setMessages((m) => [...m, { id: nextId.current++, role: 'ai', text: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { id: nextId.current++, role: 'ai', text: (e as Error).message || 'Something went wrong. Please try again.', error: true }]);
    } finally {
      setThinking(false);
    }
  };

  const parse = async () => {
    if (parsing || !quick.trim()) return;
    setParsing(true);
    setDraft(null);
    try {
      const today = todayKey();
      const [workplaces, categories] = await Promise.all([listWorkplaces(db), listCategories(db)]);
      const raw = await parseQuickAdd(quickAddInstructions(today, categories, workplaces), quick.trim());
      const result = resolveDraft(raw, { today, workplaces, categories });
      if (result.ok) setDraft(result.draft);
      else Alert.alert('Need a bit more', result.message);
    } catch (e) {
      Alert.alert('Couldn’t understand that', (e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveDraft(db, draft);
      haptic('success');
      notifyDataChanged('all');
      setDraft(null);
      setQuick('');
    } catch (e) {
      haptic('error');
      Alert.alert('Couldn’t save', e instanceof ValidationError ? e.message : 'An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  };

  const described = draft ? describeDraft(draft) : null;
  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <Screen largeTitle={false}>
      <Card>
        <Row>
          <GradientTile icon="sparkles" tone="accent" size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">Personal AI</Text>
            <Text variant="footnote" tone="secondary">
              Runs on this iPhone with Apple Intelligence. Works offline; your data never leaves the device.
            </Text>
          </View>
        </Row>
      </Card>

      <View style={{ gap: spacing.sm }}>
        <Text variant="footnote" tone="secondary" style={styles.label}>
          QUICK ADD
        </Text>
        <Row gap={spacing.sm}>
          <TextInput
            style={[inputStyle, { flex: 1 }]}
            value={quick}
            onChangeText={setQuick}
            placeholder="Shift at Cafe Nero Sat 9-5"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            onSubmitEditing={() => void parse()}
            maxLength={200}
          />
          <Button title="Add" onPress={() => void parse()} loading={parsing} disabled={!quick.trim() || parsing} style={{ minHeight: 48, paddingHorizontal: spacing.lg }} />
        </Row>
        {described ? (
          <Card>
            <Text variant="headline">{described.title}</Text>
            {described.lines.map((l) => (
              <Text key={l} variant="subhead" tone="secondary">
                {l}
              </Text>
            ))}
            <Row gap={spacing.sm}>
              <Button title="Cancel" kind="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
              <Button title="Save" icon="checkmark" onPress={() => void save()} loading={saving} style={{ flex: 1 }} />
            </Row>
          </Card>
        ) : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="footnote" tone="secondary" style={styles.label}>
          ASK ABOUT YOUR DATA
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {SUGGESTIONS.map((s) => (
            <Chip key={s.label} label={s.label} onPress={() => void ask(s.prompt, s.label)} />
          ))}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        {messages.map((m) => (
          <View
            key={m.id}
            style={[
              styles.bubble,
              m.role === 'user'
                ? { alignSelf: 'flex-end', backgroundColor: colors.accent }
                : { alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: m.error ? colors.danger : colors.border, borderWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <Text variant="callout" color={m.role === 'user' ? colors.onAccent : m.error ? colors.danger : colors.text}>
              {m.text}
            </Text>
          </View>
        ))}
        {thinking ? (
          <Row gap={8} style={[styles.bubble, { alignSelf: 'flex-start', backgroundColor: colors.surface }]}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text variant="subhead" tone="secondary">
              Thinking on-device…
            </Text>
          </Row>
        ) : null}
      </View>

      <Row gap={spacing.sm}>
        <TextInput
          style={[inputStyle, { flex: 1 }]}
          value={question}
          onChangeText={setQuestion}
          placeholder="How much did I earn this month?"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={() => void ask(question)}
          maxLength={300}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask"
          onPress={() => void ask(question)}
          disabled={!question.trim() || thinking}
          style={[styles.send, { backgroundColor: colors.accent, opacity: !question.trim() || thinking ? 0.4 : 1 }]}
        >
          <Icon name="arrow.up" color={colors.onAccent} size={18} />
        </Pressable>
      </Row>
      <Text variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
        AI can make mistakes. Money and tax figures come from your records; tax is an estimate.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { letterSpacing: 0.6, paddingHorizontal: spacing.xs },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, fontSize: 17 },
  bubble: { maxWidth: '88%', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
