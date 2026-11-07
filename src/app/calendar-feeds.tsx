import { useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { ColorField, FormSection, TextField } from '@/components/form';
import { Button, Card, Divider, Icon, QueryView, Row, Screen, Text } from '@/components/ui';
import { addFeed, listFeeds, removeFeed, syncFeed, type CalendarFeed } from '@/database/repositories/calendarFeeds';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { useQuery } from '@/services/useQuery';
import { SWATCHES, spacing } from '@/theme/tokens';
import { ValidationError } from '@/utils/result';
import { formatClock, formatDateKey, toDateKey, todayKey } from '@/utils/time';

function lastSynced(feed: CalendarFeed): string {
  if (!feed.lastSyncedAt) return 'Not synced yet';
  const day = toDateKey(new Date(feed.lastSyncedAt));
  return `Synced ${day === todayKey() ? 'today' : formatDateKey(day)} at ${formatClock(feed.lastSyncedAt)}`;
}

/**
 * Subscribe to an .ics link (uni timetable, Outlook, Google Calendar "secret
 * address"). MyOrbit only downloads the link you add — over HTTPS — and keeps
 * the events on this iPhone. Refreshes when stale and on demand.
 */
export default function CalendarFeedsScreen() {
  const { db, colors, notifyDataChanged } = useApp();
  const haptic = useHaptics();
  const query = useQuery((d) => listFeeds(d));
  const [name, setName] = useState('Uni timetable');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState<string>(SWATCHES[1]);
  const [busy, setBusy] = useState<number | 'new' | null>(null);

  const sync = async (feed: CalendarFeed) => {
    setBusy(feed.id);
    try {
      const n = await syncFeed(db, feed);
      haptic('success');
      Alert.alert('Calendar synced', `${n} ${n === 1 ? 'event' : 'events'} imported.`);
    } catch (e) {
      haptic('error');
      Alert.alert('Couldn’t sync', (e as Error).message);
    } finally {
      setBusy(null);
      notifyDataChanged('all');
    }
  };

  const add = async () => {
    setBusy('new');
    try {
      const id = await addFeed(db, { name, url, color });
      const feed = (await listFeeds(db)).find((f) => f.id === id)!;
      setUrl('');
      await sync(feed);
    } catch (e) {
      haptic('error');
      if (e instanceof ValidationError) Alert.alert('Check the link', e.message);
      else {
        console.error('Add feed failed', e);
        Alert.alert('Couldn’t add calendar', 'An unexpected error occurred.');
      }
      setBusy(null);
    }
  };

  const remove = (feed: CalendarFeed) =>
    Alert.alert(`Remove “${feed.name}”?`, 'Its events will be removed from MyOrbit. Your uni calendar itself isn’t affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void removeFeed(db, feed.id).then(() => notifyDataChanged('all')),
      },
    ]);

  return (
    <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing}>
      <QueryView query={query}>
        {(feeds) =>
          feeds.length === 0 ? null : (
            <Card>
              {feeds.map((f, i) => (
                <View key={f.id} style={{ gap: spacing.sm }}>
                  {i > 0 ? <Divider /> : null}
                  <Row>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: f.color }} />
                    <View style={{ flex: 1 }}>
                      <Text variant="headline">{f.name}</Text>
                      <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {lastSynced(f)}
                      </Text>
                    </View>
                    {busy === f.id ? <ActivityIndicator color={colors.textSecondary} /> : null}
                  </Row>
                  {f.lastError ? (
                    <Row gap={6}>
                      <Icon name="exclamationmark.triangle.fill" color={colors.warning} size={12} />
                      <Text variant="footnote" tone="warning" style={{ flex: 1 }}>
                        {f.lastError}
                      </Text>
                    </Row>
                  ) : null}
                  <Row>
                    <Button title="Sync now" kind="secondary" icon="arrow.clockwise" onPress={() => void sync(f)} disabled={busy !== null} style={{ flex: 1, minHeight: 40 }} />
                    <Button title="Remove" kind="plain" onPress={() => remove(f)} style={{ minHeight: 40 }} />
                  </Row>
                </View>
              ))}
            </Card>
          )
        }
      </QueryView>

      <FormSection
        title="Add a calendar link"
        footer="Paste your timetable’s iCal / .ics link (it usually starts with https:// or webcal://). In most uni timetable systems it’s under “Subscribe”, “Export” or “Sync to calendar”. Keep the link private — anyone with it can see your timetable."
      >
        <TextField label="Name" value={name} onChangeText={setName} maxLength={80} />
        <TextField
          label="Link"
          value={url}
          onChangeText={setUrl}
          placeholder="https://…/timetable.ics"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          maxLength={2048}
          last
        />
      </FormSection>
      <FormSection title="Colour">
        <ColorField value={color} onChange={setColor} last />
      </FormSection>
      <Button title="Add & sync" icon="link" onPress={() => void add()} loading={busy === 'new'} disabled={!url.trim() || busy !== null} />
    </Screen>
  );
}
