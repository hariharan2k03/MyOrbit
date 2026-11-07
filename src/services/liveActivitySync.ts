import { getActiveActivitySession, setNativeActivityId, type ActivityKind, type ActivitySession } from '@/database/repositories/activities';
import type { SqlDb } from '@/database/types';
import { formatClock } from '@/utils/time';
import type { TimerActivityProps } from '@/widgets/TimerActivity';

const KIND_STYLE: Record<ActivityKind, { label: string; icon: string; color: string }> = {
  focus: { label: 'FOCUS', icon: 'brain.head.profile', color: '#5AA2FF' },
  break: { label: 'BREAK', icon: 'cup.and.saucer.fill', color: '#2DD4BF' },
  study: { label: 'STUDY', icon: 'book.fill', color: '#A3E635' },
  work: { label: 'SHIFT', icon: 'briefcase.fill', color: '#22D3EE' },
};

/** Builds the Live Activity content for a session. Exported for tests. */
export function timerActivityProps(s: ActivitySession, now = Date.now()): TimerActivityProps {
  const style = KIND_STYLE[s.kind];
  return {
    label: style.label,
    title: s.title,
    subtitle: s.subtitle ?? (s.nextActivity ? `Next: ${s.nextActivity}` : ''),
    icon: style.icon,
    color: style.color,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    footnote: now < s.startsAt ? `Starts ${formatClock(s.startsAt)}` : `Ends ${formatClock(s.endsAt)}`,
  };
}

type Factory = typeof import('@/widgets/TimerActivity').default;
let factory: Factory | null | undefined;
function getFactory(): Factory | null {
  if (factory === undefined) {
    try {
      // Loaded lazily so a widget-extension problem can never stop the app from starting.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      factory = (require('@/widgets/TimerActivity') as typeof import('@/widgets/TimerActivity')).default;
    } catch (e) {
      console.warn('Live Activities unavailable', e);
      factory = null;
    }
  }
  return factory;
}

let queue: Promise<void> = Promise.resolve();

/**
 * Makes the Lock Screen / Dynamic Island match the database: one Live
 * Activity while a timer session is active, none otherwise. Calls are
 * serialised so two quick data changes can't start two activities.
 */
export function syncTimerActivity(db: SqlDb): Promise<void> {
  queue = queue.then(() => doSync(db)).catch((e) => console.warn('Live Activity sync failed', e));
  return queue;
}

async function doSync(db: SqlDb): Promise<void> {
  const f = getFactory();
  if (!f) return;
  const session = await getActiveActivitySession(db);
  const instances = f.getInstances();
  const keep = session ? instances.find((i) => i.getId() === session.nativeActivityId) : undefined;
  await Promise.all(instances.filter((i) => i !== keep).map((i) => i.end('immediate')));
  if (!session) return;
  const props = timerActivityProps(session);
  if (keep) {
    await keep.update(props, new Date(session.endsAt));
    return;
  }
  // Throws if the user turned Live Activities off for MyOrbit; the in-app timer still works.
  const started = f.start(props, 'daypilot://focus', new Date(session.endsAt));
  await setNativeActivityId(db, session.id, started.getId());
}
