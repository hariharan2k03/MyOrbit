import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import type { AppSettings } from '@/database/repositories/settings';
import type { SqlDb } from '@/database/types';
import { planReminders } from '@/features/reminders/planReminders';

// Show reminders as banners even while MyOrbit is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function hasNotificationPermission(): Promise<boolean> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted;
}

/** Asks iOS once; afterwards iOS answers from the user's choice without showing a prompt. */
export async function requestNotificationPermission(): Promise<boolean> {
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return p.granted;
}

let queue: Promise<void> = Promise.resolve();

/**
 * Replaces every pending MyOrbit notification with a fresh plan from the data.
 * At most 60 are pending, so a full rebuild is cheap and can't leave a stale
 * reminder behind (e.g. for a shift that was moved or deleted). Serialised so
 * overlapping data changes can't interleave.
 */
export function syncReminders(db: SqlDb, settings: AppSettings): Promise<void> {
  queue = queue.then(() => doSync(db, settings)).catch((e) => console.warn('Reminder sync failed', e));
  return queue;
}

async function doSync(db: SqlDb, settings: AppSettings): Promise<void> {
  const allowed = settings.notificationsEnabled && (await hasNotificationPermission());
  const plan = allowed ? await planReminders(db, settings) : [];
  await Notifications.cancelAllScheduledNotificationsAsync();
  const scheduled: { r: (typeof plan)[number]; id: string }[] = [];
  for (const r of plan) {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: r.title, body: r.body, data: { url: r.url }, sound: 'default' },
      trigger: r.daily
        ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: r.daily.hour, minute: r.daily.minute }
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.fireAt) },
    });
    scheduled.push({ r, id });
  }
  // The reminders table mirrors what iOS holds, for debugging and backup.
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM reminders');
    for (const { r, id } of scheduled) {
      await db.runAsync(
        'INSERT INTO reminders (entity_type, entity_id, kind, fire_at, notification_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [r.entityType, r.entityId, r.kind, r.fireAt, id, Date.now()],
      );
    }
  });
}

/**
 * Opens the screen a tapped reminder points at — whether the tap launched the
 * app or arrived while it was running. Each response is handled once.
 */
export function useReminderTaps(open: (url: string) => void): void {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = `${response.notification.request.identifier}:${response.notification.date}`;
    if (handled.current === key) return;
    handled.current = key;
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('daypilot://')) open(url);
  }, [response, open]);
}
