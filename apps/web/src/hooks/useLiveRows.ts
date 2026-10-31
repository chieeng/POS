import { useEffect, useState } from 'react';
import { watchTable, type Change } from '@/lib/realtime';

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
  /** A Realtime filter such as `product_id=eq.<id>`: only changes to those rows arrive. */
  filter?: string;
  /**
   * Apply each change to the list instead of loading the whole list again (SRS 7.1). Only for
   * a query that loads every row of the table the user may read, because a change cannot be
   * checked against any other condition of the query.
   */
  apply?: {
    /** The row's primary key; a deleted row's change carries only its key columns. */
    key: (row: Row) => string;
    /** The list's order, kept after each change. */
    compare?: (a: T, b: T) => number;
  };
}

interface Entry<T> {
  key: string;
  item: T;
}

/**
 * A live list (SRS 7.1): loads the rows, then keeps them current from Supabase Realtime,
 * either by applying each changed row (`apply`) or by loading the list again. Both the query
 * and the change feed are subject to Row Level Security, so a user only ever sees, and is
 * only ever told about, rows they may read.
 */
export function useLiveRows<T>({
  table,
  queryKey,
  load,
  map,
  filter,
  apply,
}: LiveRowsOptions<T>): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: [], loading: true, error: false });

  useEffect(() => {
    let cancelled = false;
    let entries: Entry<T>[] = [];
    // Each load gets a number, so an older one that finishes late is ignored.
    let run = 0;
    let loading = false;
    let changedWhileLoading = false;

    const show = () => {
      if (apply?.compare) {
        const compare = apply.compare;
        entries.sort((a, b) => compare(a.item, b.item));
      }
      setState({ data: entries.map((entry) => entry.item), loading: false, error: false });
    };
    const failed = () => {
      if (!cancelled) setState({ data: [], loading: false, error: true });
    };
    const refresh = () => {
      const mine = ++run;
      loading = true;
      changedWhileLoading = false;
      load().then(
        ({ data, error }) => {
          if (cancelled || mine !== run) return;
          loading = false;
          if (error || !data) return failed();
          // A change that arrived during the load may or may not be in it: load once more.
          if (changedWhileLoading) return refresh();
          entries = data.map((row) => ({ key: apply ? apply.key(row) : '', item: map(row) }));
          show();
        },
        () => {
          if (mine === run) loading = false;
          failed();
        },
      );
    };

    const applyChange = (change: Change) => {
      if (loading) {
        changedWhileLoading = true;
        return;
      }
      // A change too large to send whole arrives with errors and without its columns.
      if (!apply || change.errors?.length) return refresh();
      if (change.eventType === 'DELETE') {
        const key = apply.key(change.old);
        entries = entries.filter((entry) => entry.key !== key);
      } else {
        const entry = { key: apply.key(change.new), item: map(change.new) };
        const at = entries.findIndex((each) => each.key === entry.key);
        entries =
          at < 0 ? [...entries, entry] : entries.map((each, i) => (i === at ? entry : each));
      }
      show();
    };

    refresh();
    const stop = watchTable(table, filter, { change: applyChange, resync: refresh });
    return () => {
      cancelled = true;
      stop();
    };
    // `load`, `map` and `apply` are expected to be stable for a given `queryKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, queryKey, filter]);

  return state;
}
