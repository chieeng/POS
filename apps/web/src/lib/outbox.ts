import Dexie, { liveQuery, type Table } from 'dexie';
import { isNetworkError } from '@/features/auth/authErrors';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';

/**
 * The device outbox (SRS 2, NFR-02): what was made offline waits here until the server has
 * it. Sales come first (build step 9), clock-ins later (step 11). Each item keeps the id the
 * device gave it, so sending it twice is safe (POS-06).
 *
 * Its own database, apart from the saved product list: signing out clears that list, never
 * this. Nothing in here is ever dropped (the Owner's decision of Oct 31, 2026).
 */
export type OutboxKind = 'sale' | 'clock_in';

export interface OutboxItem {
  /** The client-generated id of the sale or clock-in, also its key on the server. */
  id: string;
  kind: OutboxKind;
  /** Who made it: only their own session sends it. */
  uid: string;
  branchId: string;
  payload: Record<string, unknown>;
  madeAt: number;
  /**
   * waiting: not on the server yet. needsAttention: the server refused it for good; it stays
   * on this device, and the Owner is told through the audit log (`reported`).
   */
  status: 'waiting' | 'needsAttention';
  attempts: number;
  error?: string;
  reported?: boolean;
}

class OutboxDb extends Dexie {
  items!: Table<OutboxItem, string>;

  constructor() {
    super('pos-outbox');
    this.version(1).stores({ items: 'id, uid, status, madeAt' });
  }
}

let db: OutboxDb | null = null;

function open(): OutboxDb {
  if (typeof indexedDB === 'undefined') throw new Error('This browser cannot keep data offline.');
  db ??= new OutboxDb();
  return db;
}

/**
 * Keeps something made offline until it is sent. Throws if the device cannot store it, so
 * the screen can say so instead of losing it.
 */
export async function addToOutbox(
  item: Pick<OutboxItem, 'id' | 'kind' | 'uid' | 'branchId' | 'payload'>,
): Promise<void> {
  await open().items.add({ ...item, madeAt: Date.now(), status: 'waiting', attempts: 0 });
  void syncOutbox(item.uid);
}

/** What the server said to one item. */
export type SendResult = { sent: true } | { retry: true } | { rejected: string };

type Sender = (item: OutboxItem) => Promise<SendResult>;

const senders = new Map<OutboxKind, Sender>();

/** How one kind of item is sent; registered by the feature that makes them (checkout). */
export function registerSender(kind: OutboxKind, send: Sender): () => void {
  senders.set(kind, send);
  return () => {
    if (senders.get(kind) === send) senders.delete(kind);
  };
}

/**
 * Sorts a failed send: no connection, a server that is down or busy, or an expired token is
 * tried again later; anything else is the server refusing this item for good.
 */
export function sendFailure(error: unknown): SendResult {
  if (isNetworkError(error)) return { retry: true };
  const { status, code, message } = (error ?? {}) as {
    status?: number;
    code?: string;
    message?: string;
  };
  if (status !== undefined && (status >= 500 || status === 408 || status === 429)) {
    return { retry: true };
  }
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return { retry: true };
  const text = typeof message === 'string' && message.trim() ? message.trim() : 'Refused.';
  return { rejected: text.slice(0, 200) };
}

let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/**
 * Sends this user's waiting items, oldest first, one at a time. Stops at the first item that
 * should be tried again (the connection is likely down), and reports items the server refused
 * so the Owner sees them. Safe to call often: one run at a time, and a call during a run gets
 * one more run after it, so an item added meanwhile is not left for the next timer.
 */
export function syncOutbox(uid: string): Promise<void> {
  if (running) {
    queued ??= running.then(() => {
      queued = null;
      return syncOutbox(uid);
    });
    return queued;
  }
  running = (async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const items = open().items;
    const mine = (await items.where('uid').equals(uid).sortBy('madeAt')).filter(
      (item) => item.status === 'waiting',
    );
    for (const item of mine) {
      const send = senders.get(item.kind);
      if (!send) continue;
      const result = await send(item).catch(sendFailure);
      if ('sent' in result) {
        await items.delete(item.id);
      } else if ('retry' in result) {
        await items.update(item.id, { attempts: item.attempts + 1 });
        break;
      } else {
        await items.update(item.id, {
          status: 'needsAttention',
          error: result.rejected,
          attempts: item.attempts + 1,
        });
      }
    }
    await reportRefused(uid);
  })()
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
  return running;
}

// The audit log takes at most 20 KB of what was entered (report_unsent).
const MAX_REPORTED = 19_000;

async function reportRefused(uid: string) {
  const items = open().items;
  const refused = (await items.where('uid').equals(uid).toArray()).filter(
    (item) => item.status === 'needsAttention' && !item.reported,
  );
  for (const item of refused) {
    const entry =
      JSON.stringify(item.payload).length > MAX_REPORTED
        ? { note: 'Too large to copy here; it is kept on the device.' }
        : item.payload;
    const { error } = await supabase.rpc('report_unsent', {
      p_item_id: item.id,
      p_kind: item.kind,
      p_error: item.error ?? 'Refused.',
      p_made_at: new Date(item.madeAt).toISOString(),
      p_payload: entry,
      p_device_tag: getDeviceTag(),
    });
    // Not sent now: the next run tries again.
    if (error) return;
    await items.update(item.id, { reported: true });
  }
}

export interface OutboxCounts {
  /** This user's items not on the server yet. */
  waiting: number;
  /** Items on this device the server refused (anyone's): they stay until dealt with. */
  needsAttention: number;
}

/** Live counts for the connection pill and the sign-out check, across tabs. */
export function watchOutbox(uid: string, onChange: (counts: OutboxCounts) => void): () => void {
  if (typeof indexedDB === 'undefined') return () => undefined;
  const subscription = liveQuery(async () => {
    const all = await open().items.toArray();
    return {
      waiting: all.filter((item) => item.uid === uid && item.status === 'waiting').length,
      needsAttention: all.filter((item) => item.status === 'needsAttention').length,
    };
  }).subscribe({ next: onChange, error: () => undefined });
  return () => subscription.unsubscribe();
}

/** This user's items not on the server yet: while there are any, they may not sign out. */
export async function countWaiting(uid: string): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  try {
    return (await open().items.where('uid').equals(uid).toArray()).filter(
      (item) => item.status === 'waiting',
    ).length;
  } catch {
    return 0;
  }
}

/** Test only: forget everything. */
export async function resetOutboxForTests(): Promise<void> {
  await open().items.clear();
}
