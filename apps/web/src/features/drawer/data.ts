import { useCallback, useEffect, useState } from 'react';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';

/** SHIFT-01: today's drawer, as every staff member may see it (never expected cash). */
export interface DrawerSession {
  id: string;
  businessDate: string;
  status: 'open' | 'closed' | 'not_counted';
  openedByName: string;
  openedAt: Date;
  openingCash: number;
}

export interface LastCount {
  amount: number;
  countedByName: string;
  closedAt: Date;
  businessDate: string;
}

export interface DrawerToday {
  /** "YYYY-MM-DD", the store's business day (Asia/Manila). */
  today: string;
  session: DrawerSession | null;
  /** The last closing count before today; the opening cash is pre-filled from it. */
  lastCount: LastCount | null;
  /** A drawer from an earlier day is still open; opening today's closes it as not counted. */
  staleOpen: boolean;
}

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;

export function toDrawerToday(raw: unknown): DrawerToday {
  const data = asObject(raw) ?? {};
  const session = asObject(data.session);
  const last = asObject(data.lastCount);
  return {
    today: String(data.today ?? ''),
    session: session
      ? {
          id: String(session.id),
          businessDate: String(session.business_date),
          status: session.status as DrawerSession['status'],
          openedByName: String(session.opened_by_name ?? ''),
          openedAt: new Date(String(session.opened_at)),
          openingCash: Number(session.opening_cash ?? 0),
        }
      : null,
    lastCount: last
      ? {
          amount: Number(last.amount ?? 0),
          countedByName: String(last.counted_by_name ?? ''),
          closedAt: new Date(String(last.closed_at)),
          businessDate: String(last.business_date),
        }
      : null,
    staleOpen: data.staleOpen === true,
  };
}

export interface DrawerState {
  data: DrawerToday | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
}

/**
 * Today's drawer. Staff read it through drawer_today (Row Level Security shows them no
 * drawer rows), so it is asked again when the screen comes back into view or the device
 * is back online, and after every change made here.
 */
export function useDrawerToday(): DrawerState {
  const [state, setState] = useState<Omit<DrawerState, 'reload'>>({
    data: null,
    loading: true,
    error: false,
  });
  const reload = useCallback(() => {
    void supabase.rpc('drawer_today').then(
      ({ data, error }) =>
        setState((current) =>
          error
            ? { data: current.data, loading: false, error: !current.data }
            : { data: toDrawerToday(data), loading: false, error: false },
        ),
      () => setState((current) => ({ ...current, loading: false, error: !current.data })),
    );
  }, []);

  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', reload);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', reload);
    };
  }, [reload]);

  return { ...state, reload };
}

export type EntryType = 'cash_in' | 'cash_out';

export type EntryReason =
  'supplier_payment' | 'expense' | 'owner_withdrawal' | 'change_fund' | 'other';

export const REASON_LABELS: Record<EntryReason, string> = {
  supplier_payment: 'Supplier payment',
  expense: 'Expense',
  owner_withdrawal: 'Owner withdrawal',
  change_fund: 'Change fund',
  other: 'Other',
};

/** SHIFT-02: the design's reason chips. Money comes in only as change or for another reason. */
export const REASONS: Record<EntryType, readonly EntryReason[]> = {
  cash_out: ['supplier_payment', 'expense', 'owner_withdrawal', 'change_fund', 'other'],
  cash_in: ['change_fund', 'other'],
};

async function call<T>(fn: string, args: Json): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { ...args, p_device_tag: getDeviceTag() });
  if (error) throw error;
  return data as T;
}

/** SHIFT-01: open today's drawer. `reason` is needed when the amount differs from the last count. */
export const openDrawer = (openingCash: number, reason: string | null) =>
  call<string>('open_drawer', { p_opening_cash: openingCash, p_reason: reason });

/** SHIFT-02: cash in or out of today's drawer. */
export const recordDrawerEntry = (
  type: EntryType,
  amount: number,
  reason: EntryReason,
  note: string | null,
) =>
  call<string>('record_drawer_entry', {
    p_type: type,
    p_amount: amount,
    p_reason: reason,
    p_note: note,
  });

/** The Owner only: expected cash in today's open drawer (null when none is open). */
export async function fetchExpectedCash(): Promise<number | null> {
  const { data, error } = await supabase.rpc('drawer_expected_cash');
  if (error) throw error;
  return data === null ? null : Number(data);
}

/**
 * Reads a peso amount as typed: "1800", "1,800.50", "₱ 350". Null if it isn't one, or has
 * more than two decimals.
 */
export function parsePeso(text: string): number | null {
  const plain = text.replace(/[₱,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(plain)) return null;
  return Number(plain);
}

export function describeDrawerError(error: unknown): string {
  const { message } = (error ?? {}) as { message?: unknown };
  switch (message) {
    case 'already_open':
      return 'Someone already opened today’s drawer.';
    case 'already_closed':
      return 'Today’s drawer was already counted and closed. Later sales go to tomorrow’s drawer.';
    case 'reason_required':
      return 'Say why the amount differs from the last count.';
    case 'drawer_not_open':
      return 'Today’s drawer isn’t open. Open it first.';
    case 'invalid_input':
      return 'Check the amount and the note.';
    default:
      return 'That didn’t go through. Check your connection and try again.';
  }
}

/** SHIFT-03: the bills and coins counted at closing, largest first. No 25-centavo coins. */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;

export type Counts = Record<(typeof DENOMINATIONS)[number], number>;

export const emptyCounts = (): Counts =>
  Object.fromEntries(DENOMINATIONS.map((bill) => [bill, 0])) as Counts;

export const countedTotal = (counts: Counts) =>
  DENOMINATIONS.reduce((sum, bill) => sum + bill * counts[bill], 0);

export interface CloseResult {
  expected: number;
  counted: number;
  overShort: number;
}

/**
 * SHIFT-03: the Owner or Special Sales closes today's drawer with the count. Expected cash
 * and the over/short come back only now: the count is blind.
 */
export async function closeDrawer(counts: Counts, note: string | null): Promise<CloseResult> {
  const result = await call<Json>('close_drawer', {
    p_counts: Object.fromEntries(DENOMINATIONS.map((bill) => [String(bill), counts[bill]])),
    p_note: note,
  });
  return {
    expected: Number(result.expected),
    counted: Number(result.counted),
    overShort: Number(result.overShort),
  };
}
