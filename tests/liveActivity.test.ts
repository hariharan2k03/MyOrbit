import type { ActivitySession } from '@/database/repositories/activities';
import { timerActivityProps } from '@/services/liveActivitySync';

const base: ActivitySession = {
  id: 1,
  kind: 'focus',
  title: 'Focus session',
  subtitle: '25 min',
  entityType: null,
  entityId: null,
  startsAt: new Date(2026, 10, 7, 15, 0).getTime(),
  endsAt: new Date(2026, 10, 7, 15, 25).getTime(),
  nativeActivityId: null,
  nextActivity: null,
};

describe('timer Live Activity props', () => {
  it('passes the real start/end so iOS can count down on its own', () => {
    const p = timerActivityProps(base, base.startsAt + 60_000);
    expect(p).toMatchObject({ label: 'FOCUS', title: 'Focus session', subtitle: '25 min', startsAt: base.startsAt, endsAt: base.endsAt, footnote: 'Ends 3:25 PM' });
    // Live Activity content is JSON; it must not carry nulls or Dates.
    expect(JSON.stringify(p)).not.toContain('null');
  });

  it('says when a shift that has not begun yet starts', () => {
    const p = timerActivityProps({ ...base, kind: 'work', title: 'Cafe Nero', subtitle: null }, base.startsAt - 30 * 60_000);
    expect(p.label).toBe('SHIFT');
    expect(p.footnote).toBe('Starts 3:00 PM');
    expect(p.subtitle).toBe('');
  });

  it('shows what comes next for a break with no subtitle', () => {
    const p = timerActivityProps({ ...base, kind: 'break', subtitle: null, nextActivity: 'Back to focus' });
    expect(p.subtitle).toBe('Next: Back to focus');
  });
});
