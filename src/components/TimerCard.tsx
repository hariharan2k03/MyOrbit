import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { getActiveActivitySession } from '@/database/repositories/activities';
import { useQuery } from '@/services/useQuery';
import { formatClock } from '@/utils/time';
import { Button, Card, GradientTile, ProgressBar, Row, Text } from './ui';

function remainingLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Always-visible timer entry point. Shows the running session with a live
 * countdown, or buttons to start one. Study needs a subject, so without
 * subjects the timer opens in Focus mode.
 */
export function TimerCard({ hasSubjects }: { hasSubjects: boolean }) {
  const query = useQuery((db) => getActiveActivitySession(db));
  const active = query.data ?? null;
  const { refresh } = query;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [active]);

  // Once the end passes, re-query so the card returns to "start" (the session auto-completes on read).
  const finished = active !== null && now >= active.endsAt;
  useEffect(() => {
    if (finished) void refresh();
  }, [finished, refresh]);

  if (active && !finished) {
    const notStarted = now < active.startsAt;
    const progress = notStarted ? 0 : (now - active.startsAt) / (active.endsAt - active.startsAt);
    return (
      <Card onPress={() => router.push('/focus')} accessibilityLabel={`${active.title} timer, ${remainingLabel(active.endsAt - now)} left. Open timer.`}>
        <Row>
          <GradientTile icon="timer" tone="accent" size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline" numberOfLines={1}>
              {active.title}
            </Text>
            <Text variant="footnote" tone="secondary">
              {notStarted ? `Starts ${formatClock(active.startsAt)}` : `Ends ${formatClock(active.endsAt)}`}
            </Text>
          </View>
          <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>
            {remainingLabel(notStarted ? active.startsAt - now : active.endsAt - now)}
          </Text>
        </Row>
        <ProgressBar value={progress} />
      </Card>
    );
  }

  return (
    <Card>
      <Row>
        <GradientTile icon="timer" tone="accent" size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">Timer</Text>
          <Text variant="footnote" tone="secondary">
            Shows on your Lock Screen and in the Dynamic Island while it runs.
          </Text>
        </View>
      </Row>
      <Row>
        <Button title="Focus" icon="brain.head.profile" kind="secondary" onPress={() => router.push({ pathname: '/focus', params: { kind: 'focus' } })} style={{ flex: 1 }} />
        <Button title="Study" icon="book.fill" kind="secondary" onPress={() => router.push({ pathname: '/focus', params: { kind: hasSubjects ? 'study' : 'focus' } })} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}
