import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SqlDb } from '@/database/types';
import { useApp } from './AppContext';

export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * Runs a DB query on mount, on screen focus and whenever data changes
 * anywhere in the app. Stale responses from superseded runs are dropped.
 * `deps` must be primitives (they're compared by value).
 */
export function useQuery<T>(fn: (db: SqlDb) => Promise<T>, deps: readonly (string | number | boolean | null | undefined)[] = []): QueryState<T> {
  const { db, dataVersion } = useApp();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const runId = useRef(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const depsKey = JSON.stringify(deps);

  const run = useCallback(async () => {
    const id = ++runId.current;
    try {
      const result = await fnRef.current(db);
      if (id === runId.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (id === runId.current) setLoading(false);
    }
    // depsKey re-creates `run` when the caller's inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, depsKey]);

  useEffect(() => {
    void run();
  }, [run, dataVersion]);

  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await run();
    setRefreshing(false);
  }, [run]);

  return { data, error, loading, refreshing, refresh };
}
