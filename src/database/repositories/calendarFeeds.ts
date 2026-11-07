import { normaliseFeedUrl, parseIcs } from '@/features/calendar/ics';
import { unwrap, ValidationError } from '@/utils/result';
import { addDays, dateFromKey, toDateKey } from '@/utils/time';
import { cleanText, LIMITS } from '@/utils/validation';
import type { SqlDb } from '../types';

export interface CalendarFeed {
  id: number;
  name: string;
  url: string;
  color: string;
  lastSyncedAt: number | null;
  lastError: string | null;
}

type FeedRow = { id: number; name: string; url: string; color: string; last_synced_at: number | null; last_error: string | null };

const toFeed = (r: FeedRow): CalendarFeed => ({ id: r.id, name: r.name, url: r.url, color: r.color, lastSyncedAt: r.last_synced_at, lastError: r.last_error });

export const MAX_FEED_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
/** Feeds older than this are refreshed when the app comes to the foreground. */
export const FEED_STALE_MS = 6 * 3_600_000;

export async function listFeeds(db: SqlDb): Promise<CalendarFeed[]> {
  return (await db.getAllAsync<FeedRow>('SELECT * FROM calendar_feeds ORDER BY name')).map(toFeed);
}

export async function addFeed(db: SqlDb, input: { name: string; url: string; color?: string }): Promise<number> {
  const name = unwrap(cleanText(input.name, 'Name', LIMITS.name, { required: true }));
  let url: string;
  try {
    url = normaliseFeedUrl(input.url);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  const color = /^#[0-9A-Fa-f]{6}$/.test(input.color ?? '') ? input.color! : '#60A5FA';
  try {
    const r = await db.runAsync('INSERT INTO calendar_feeds (name, url, color, created_at) VALUES (?, ?, ?, ?)', [name, url, color, Date.now()]);
    return r.lastInsertRowId;
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ValidationError('You’ve already added this calendar link.');
    throw e;
  }
}

/** Deleting a feed removes its imported events (ON DELETE CASCADE). */
export async function removeFeed(db: SqlDb, id: number): Promise<void> {
  await db.runAsync('DELETE FROM calendar_feeds WHERE id = ?', [id]);
}

type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; headers: { get(name: string): string | null } }>;

/**
 * Downloads and re-imports one feed. Events from 60 days ago to a year ahead
 * replace the feed's previous events in a single transaction, so a failed sync
 * never leaves a half-imported calendar. Errors are stored on the feed.
 */
export async function syncFeed(db: SqlDb, feed: CalendarFeed, fetcher: Fetcher = fetch as unknown as Fetcher, now = Date.now()): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(feed.url, { signal: controller.signal, headers: { Accept: 'text/calendar, text/plain;q=0.8' } });
    if (!res.ok) throw new Error(res.status === 404 ? 'Calendar link not found (404). Check the link is still valid.' : `The server returned an error (${res.status}).`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_FEED_BYTES) throw new Error('This calendar is too large to import (over 5 MB).');
    const text = await res.text();
    if (text.length > MAX_FEED_BYTES) throw new Error('This calendar is too large to import (over 5 MB).');

    const today = toDateKey(new Date(now));
    const events = parseIcs(text, { from: dateFromKey(addDays(today, -60)).getTime(), to: dateFromKey(addDays(today, 366)).getTime() });
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM events WHERE feed_id = ?', [feed.id]);
      for (const e of events) {
        await db.runAsync(
          `INSERT OR IGNORE INTO events (title, event_date, start_at, end_at, important, notes, created_at, updated_at, feed_id, uid, location, all_day)
           VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?)`,
          [e.title, toDateKey(new Date(e.startAt)), e.startAt, e.endAt, now, now, feed.id, e.uid, e.location, e.allDay ? 1 : 0],
        );
      }
      await db.runAsync('UPDATE calendar_feeds SET last_synced_at = ?, last_error = NULL WHERE id = ?', [now, feed.id]);
    });
    return events.length;
  } catch (e) {
    const message = controller.signal.aborted ? 'The calendar took too long to respond.' : e instanceof Error ? e.message : 'Couldn’t sync this calendar.';
    await db.runAsync('UPDATE calendar_feeds SET last_error = ? WHERE id = ?', [message.slice(0, 200), feed.id]);
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

/** Syncs feeds that haven't synced recently. Failures are recorded per feed, not thrown. */
export async function syncStaleFeeds(db: SqlDb, now = Date.now()): Promise<void> {
  for (const feed of await listFeeds(db)) {
    if (feed.lastSyncedAt !== null && now - feed.lastSyncedAt < FEED_STALE_MS) continue;
    try {
      await syncFeed(db, feed, undefined, now);
    } catch (e) {
      console.warn(`Calendar feed "${feed.name}" failed to sync:`, (e as Error).message);
    }
  }
}
