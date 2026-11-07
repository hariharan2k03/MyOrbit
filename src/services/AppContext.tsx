import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Appearance, useColorScheme } from 'react-native';
import { getDatabase } from '@/database/client';
import { DEFAULT_SETTINGS, loadSettings, saveSetting, type AppSettings } from '@/database/repositories/settings';
import type { SqlDb } from '@/database/types';
import { dark, light, type Palette } from '@/theme/tokens';

export type DataDomain = 'work' | 'money' | 'study' | 'tasks' | 'habits' | 'activity' | 'settings' | 'all';

interface AppContextValue {
  db: SqlDb;
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  /** Re-reads every setting from SQLite (after a restore). */
  reloadSettings: () => Promise<void>;
  colors: Palette;
  isDark: boolean;
  reduceMotion: boolean;
  /** Increments whenever data changes, so mounted screens re-query. */
  dataVersion: number;
  notifyDataChanged: (domain: DataDomain) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

type Listener = (domain: DataDomain) => void;
const listeners = new Set<Listener>();

/** Side effects (widget refresh, notification reconcile) subscribe here. */
export function onDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type LoadState = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; db: SqlDb; settings: AppSettings };

export function useAppBootstrap() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const load = useCallback(() => {
    getDatabase()
      .then(async (db) => setState({ status: 'ready', db, settings: await loadSettings(db) }))
      .catch((error: unknown) => setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) }));
  }, []);
  useEffect(load, [load]);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);
  return { state, retry };
}

export function AppProvider({ db, initialSettings, children }: { db: SqlDb; initialSettings: AppSettings; children: ReactNode }) {
  const [settings, setSettings] = useState(initialSettings);
  const [dataVersion, setDataVersion] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const system = useColorScheme();

  // Apply the chosen theme to iOS itself, so native UI (status bar, tab bar, alerts,
  // date pickers, keyboard) matches the app instead of following the system setting.
  useEffect(() => {
    Appearance.setColorScheme(settings.theme === 'system' ? 'unspecified' : settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion, () => setReduceMotion(false));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      await saveSetting(db, key, value);
      setSettings((s) => ({ ...s, [key]: value }));
      listeners.forEach((l) => l('settings'));
    },
    [db],
  );

  const reloadSettings = useCallback(async () => {
    setSettings(await loadSettings(db));
    listeners.forEach((l) => l('settings'));
  }, [db]);

  const notifyDataChanged = useCallback((domain: DataDomain) => {
    setDataVersion((v) => v + 1);
    listeners.forEach((l) => l(domain));
  }, []);

  const isDark = settings.theme === 'system' ? system !== 'light' : settings.theme === 'dark';

  const value = useMemo<AppContextValue>(
    () => ({ db, settings, updateSetting, reloadSettings, colors: isDark ? dark : light, isDark, reduceMotion, dataVersion, notifyDataChanged }),
    [db, settings, updateSetting, reloadSettings, isDark, reduceMotion, dataVersion, notifyDataChanged],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

/** Theme for screens rendered before the database is ready (splash/error). */
export function useFallbackColors(): Palette {
  return useColorScheme() === 'light' ? light : dark;
}

export { DEFAULT_SETTINGS };
