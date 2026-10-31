import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type Change = RealtimePostgresChangesPayload<Record<string, unknown>>;

export interface TableListener {
  /** A row was inserted, updated or deleted. */
  change: (change: Change) => void;
  /** The feed reconnected: changes made while it was down are not replayed, so load again. */
  resync: () => void;
}

interface Feed {
  channel: RealtimeChannel;
  listeners: Set<TableListener>;
}

const feeds = new Map<string, Feed>();
let opened = 0;

/**
 * One Realtime channel per table (and filter) on this device, shared by every screen that
 * watches it. Each channel receives its own copy of every change, and every copy counts
 * toward the Free plan's Realtime message quota (SRS 7.1), so screens never open their own.
 * Row Level Security decides which changes a user is told about.
 *
 * `filter` is a Realtime filter such as `product_id=eq.<id>`: the server then sends only
 * changes to those rows.
 */
export function watchTable(
  table: string,
  filter: string | undefined,
  listener: TableListener,
): () => void {
  const key = `${table}:${filter ?? '*'}`;
  let feed = feeds.get(key);
  if (!feed) {
    const listeners = new Set<TableListener>();
    let subscribedBefore = false;
    // A fresh topic each time: a channel being removed may still hold the old one.
    const channel = supabase
      .channel(`live:${key}:${++opened}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        (change: Change) => [...listeners].forEach((each) => each.change(change)),
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (subscribedBefore) [...listeners].forEach((each) => each.resync());
        subscribedBefore = true;
      });
    feed = { channel, listeners };
    feeds.set(key, feed);
  }

  const current = feed;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0 || feeds.get(key) !== current) return;
    feeds.delete(key);
    void supabase.removeChannel(current.channel);
  };
}
