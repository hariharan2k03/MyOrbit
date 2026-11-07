import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Segmented, useSaveAction } from '@/components/form';
import { EmptyState, ProgressBar, Stat } from '@/components/ui';
import { DEFAULT_SETTINGS } from '@/database/repositories/settings';
import type { SqlDb } from '@/database/types';
import { AppProvider } from '@/services/AppContext';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('@/database/client', () => ({ getDatabase: jest.fn() }));

jest.mock('expo-symbols', () => ({ SymbolView: () => null }));

// Components under test never touch the database.
const noDb = {} as SqlDb;

function wrap(ui: ReactNode) {
  return render(
    <AppProvider db={noDb} initialSettings={DEFAULT_SETTINGS}>
      {ui}
    </AppProvider>,
  );
}

describe('UI components', () => {
  it('clamps progress and exposes it to VoiceOver', async () => {
    await wrap(<ProgressBar value={1.7} />);
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
  });

  it('renders an empty state with a working action', async () => {
    const onAction = jest.fn();
    await wrap(<EmptyState icon="tray" title="Nothing here" message="Add something." action="Add" onAction={onAction} />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders stats', async () => {
    await wrap(<Stat label="Spent" value="$12.50" hint="this week" />);
    expect(screen.getByText('$12.50')).toBeTruthy();
    expect(screen.getByText('this week')).toBeTruthy();
  });

  it('changes segmented selection', async () => {
    const onChange = jest.fn();
    await wrap(
      <Segmented
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
        value="week"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Week' }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('tab', { name: 'Month' }));
    expect(onChange).toHaveBeenCalledWith('month');
  });
});

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
}));

describe('useSaveAction (B-007)', () => {
  function Harness({ value, onReady }: { value: string; onReady: (run: () => Promise<void>) => void }) {
    const save = useSaveAction(async () => {
      saved.push(value);
    }, 'money');
    onReady(save.run);
    return null;
  }
  const saved: string[] = [];

  it('always saves the latest form values, even from a stale run reference', async () => {
    saved.length = 0;
    let firstRun: (() => Promise<void>) | undefined;
    const { rerender } = await render(
      <AppProvider db={noDb} initialSettings={DEFAULT_SETTINGS}>
        <Harness value="" onReady={(r) => (firstRun ??= r)} />
      </AppProvider>,
    );
    await rerender(
      <AppProvider db={noDb} initialSettings={DEFAULT_SETTINGS}>
        <Harness value="100" onReady={() => undefined} />
      </AppProvider>,
    );
    await act(() => firstRun!());
    expect(saved).toEqual(['100']);
  });

  it('ignores a double tap while a save is running', async () => {
    saved.length = 0;
    let run: (() => Promise<void>) | undefined;
    await wrap(<Harness value="x" onReady={(r) => (run = r)} />);
    await act(() => Promise.all([run!(), run!()]).then(() => undefined));
    expect(saved).toEqual(['x']);
  });
});
