import { useEffect, useId, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: boolean;
}

type Row = Record<string, unknown>;

interface LiveRowsOptions<T> {
  /** The table to watch for changes. */
  table: string;
  /** Changes when the query changes (for example the branch or the page size). */
  queryKey: string;
  load: () => PromiseLike<{ data: Row[] | null; error: unknown }>;
  map: (row: Row) => T;
}

/**
 * A live list (SRS 7.1): loads the rows, then loads them again whenever Realtime reports a
 * change to the table. Both the query and the change feed are subject to Row Level
 * Security, so a user only ever sees, and is only ever told about, rows they may read.
 */
export function useLiveRows<T>({ table, queryKey, load, map }: LiveRowsOptions<T>): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: [], loading: true, error: false });
  const instance = useId();

  useEffect(() => {
    let cancelled = false;
    const failed = () => {
      if (!cancelled) setState({ data: [], loading: false, error: true });
    };
    const refresh = () => {
      load().then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) failed();
        else setState({ data: data.map(map), loading: false, error: false });
      }, failed);
    };

    refresh();
    const channel = supabase
      .channel(`live:${table}:${queryKey}:${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
    // `load` and `map` are expected to be stable for a given `queryKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, queryKey, instance]);

  return state;
}
