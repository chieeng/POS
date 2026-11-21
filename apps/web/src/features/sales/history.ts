import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Sales history (SRS 6.1; the owner's decisions of Nov 13, 2026): staff see their own sales for
 * the last 30 days, the Owner every sale. Both read through database functions that never show
 * a sale's cost; the server holds staff to their own 30 days whatever the screen asks.
 */
export type SaleStatus = 'completed' | 'voided' | 'corrected';
export type PayMethod = 'cash' | 'gcash' | 'maya';

export interface HistorySale {
  id: string;
  receiptNo: string;
  madeAt: Date;
  salesperson: string;
  total: number;
  /** As the customer counts them: whole units by quantity, a weighed line as one. */
  items: number;
  methods: PayMethod[];
  status: SaleStatus;
  flags: string[];
  madeOffline: boolean;
  /** POS-10: every unit came back ('all'), some did ('some'), or none (null). */
  returned: 'all' | 'some' | null;
}

export interface HistoryDay {
  /** "YYYY-MM-DD", Asia/Manila. */
  day: string;
  count: number;
  total: number;
}

export interface HistoryPage {
  sales: HistorySale[];
  days: HistoryDay[];
  hasMore: boolean;
  /** The range the server used (staff: never before 29 days back). */
  from: string;
  to: string;
}

export interface SaleDetail {
  id: string;
  receiptNo: string;
  madeAt: Date;
  syncedAt: Date;
  salesperson: string;
  subtotal: number;
  discountTotal: number;
  rounding: number;
  total: number;
  vatRate: number | null;
  vatAmount: number | null;
  change: number;
  status: SaleStatus;
  flags: string[];
  madeOffline: boolean;
  lines: {
    lineNo: number;
    name: string;
    sku: string;
    unit: string;
    qty: number;
    unitPrice: number;
    discount: number;
    /** The preset or deal it took. */
    discountName: string | null;
    lineTotal: number;
    /** POS-10: units already returned, and what they gave back. */
    returnedQty: number;
    refunded: number;
  }[];
  payments: {
    method: PayMethod;
    amount: number;
    reference: string | null;
    accountLabel: string | null;
  }[];
  /** 'ok', or why a void can't be asked for now (POS-10). */
  voidable: Voidable;
  /** How it was voided, when it was. */
  void: { at: Date; by: string; reason: string; refundReference: string | null } | null;
  /** A void request still waiting for the Owner: the caller's own, or anyone's for the Owner. */
  pendingVoid: { id: string; mine: boolean; reason: string } | null;
  /** A return request still waiting for the Owner, seen the same way. */
  pendingReturn: {
    id: string;
    mine: boolean;
    reason: string;
    refund: number;
    method: PayMethod;
  } | null;
  /** The store's return window, and whether this sale is past it (defective items only). */
  returnWindow: { days: number; late: boolean };
  /** Cash is rounded to the peso (POS-04), refunds too. */
  roundCash: boolean;
  /** Given back so far, by method. */
  refunded: Partial<Record<PayMethod, number>>;
  /** The returns made, oldest first. */
  returns: SaleReturn[];
}

export interface SaleReturn {
  at: Date;
  by: string;
  reason: string;
  refund: number;
  cashRefund: number | null;
  method: PayMethod;
  refundReference: string | null;
  defective: boolean;
  items: {
    name: string;
    unit: string;
    qty: number;
    condition: 'stock' | 'damaged';
    refund: number;
  }[];
}

export type Voidable =
  'ok' | 'sale_not_completed' | 'sale_has_returns' | 'drawer_waiting' | 'drawer_closed';
const VOIDABLE: Voidable[] = [
  'ok',
  'sale_not_completed',
  'sale_has_returns',
  'drawer_waiting',
  'drawer_closed',
];

type Json = Record<string, unknown>;

export const METHOD_LABELS: Record<PayMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
};

const num = (value: unknown) => Number(value ?? 0);
const text = (value: unknown) => (typeof value === 'string' ? value : null);

export function toHistoryPage(raw: unknown): HistoryPage {
  const data = (raw ?? {}) as Json;
  return {
    sales: ((data.sales ?? []) as Json[]).map((s) => ({
      id: String(s.id),
      receiptNo: String(s.receiptNo ?? ''),
      madeAt: new Date(String(s.madeAt)),
      salesperson: String(s.salesperson ?? ''),
      total: num(s.total),
      items: num(s.items),
      methods: (s.methods ?? []) as PayMethod[],
      status: (s.status ?? 'completed') as SaleStatus,
      flags: (s.flags ?? []) as string[],
      madeOffline: s.madeOffline === true,
      returned: s.returned === 'all' || s.returned === 'some' ? s.returned : null,
    })),
    days: ((data.days ?? []) as Json[]).map((d) => ({
      day: String(d.day),
      count: num(d.count),
      total: num(d.total),
    })),
    hasMore: data.hasMore === true,
    from: String(data.from ?? ''),
    to: String(data.to ?? ''),
  };
}

export function toSaleDetail(raw: unknown): SaleDetail {
  const s = (raw ?? {}) as Json;
  return {
    id: String(s.id),
    receiptNo: String(s.receiptNo ?? ''),
    madeAt: new Date(String(s.madeAt)),
    syncedAt: new Date(String(s.syncedAt)),
    salesperson: String(s.salesperson ?? ''),
    subtotal: num(s.subtotal),
    discountTotal: num(s.discountTotal),
    rounding: num(s.rounding),
    total: num(s.total),
    vatRate: s.vatRate === null || s.vatRate === undefined ? null : num(s.vatRate),
    vatAmount: s.vatAmount === null || s.vatAmount === undefined ? null : num(s.vatAmount),
    change: num(s.change),
    status: (s.status ?? 'completed') as SaleStatus,
    flags: (s.flags ?? []) as string[],
    madeOffline: s.madeOffline === true,
    lines: ((s.lines ?? []) as Json[]).map((l) => ({
      lineNo: num(l.lineNo),
      name: String(l.name ?? ''),
      sku: String(l.sku ?? ''),
      unit: String(l.unit ?? ''),
      qty: num(l.qty),
      unitPrice: num(l.unitPrice),
      discount: num(l.discount),
      discountName: text(l.discountName),
      lineTotal: num(l.lineTotal),
      returnedQty: num(l.returnedQty),
      refunded: num(l.refunded),
    })),
    payments: ((s.payments ?? []) as Json[]).map((p) => ({
      method: (p.method ?? 'cash') as PayMethod,
      amount: num(p.amount),
      reference: text(p.reference),
      accountLabel: text(p.accountLabel),
    })),
    voidable: VOIDABLE.includes(s.voidable as Voidable)
      ? (s.voidable as Voidable)
      : 'drawer_closed',
    void:
      s.void && typeof s.void === 'object'
        ? {
            at: new Date(String((s.void as Json).at)),
            by: String((s.void as Json).by ?? ''),
            reason: String((s.void as Json).reason ?? ''),
            refundReference: text((s.void as Json).refundReference),
          }
        : null,
    pendingVoid:
      s.pendingVoid && typeof s.pendingVoid === 'object'
        ? {
            id: String((s.pendingVoid as Json).id),
            mine: (s.pendingVoid as Json).mine === true,
            reason: String((s.pendingVoid as Json).reason ?? ''),
          }
        : null,
    pendingReturn:
      s.pendingReturn && typeof s.pendingReturn === 'object'
        ? {
            id: String((s.pendingReturn as Json).id),
            mine: (s.pendingReturn as Json).mine === true,
            reason: String((s.pendingReturn as Json).reason ?? ''),
            refund: num((s.pendingReturn as Json).refund),
            method: ((s.pendingReturn as Json).method ?? 'cash') as PayMethod,
          }
        : null,
    returnWindow: {
      days: num((s.returnWindow as Json | undefined)?.days ?? 30),
      late: (s.returnWindow as Json | undefined)?.late === true,
    },
    roundCash: s.roundCash !== false,
    refunded: Object.fromEntries(
      Object.entries((s.refunded ?? {}) as Json).map(([method, amount]) => [method, num(amount)]),
    ) as Partial<Record<PayMethod, number>>,
    returns: ((s.returns ?? []) as Json[]).map((r) => ({
      at: new Date(String(r.at)),
      by: String(r.by ?? ''),
      reason: String(r.reason ?? ''),
      refund: num(r.refund),
      cashRefund: r.cashRefund === null || r.cashRefund === undefined ? null : num(r.cashRefund),
      method: (r.method ?? 'cash') as PayMethod,
      refundReference: text(r.refundReference),
      defective: r.defective === true,
      items: ((r.items ?? []) as Json[]).map((i) => ({
        name: String(i.name ?? ''),
        unit: String(i.unit ?? ''),
        qty: num(i.qty),
        condition: i.condition === 'damaged' ? ('damaged' as const) : ('stock' as const),
        refund: num(i.refund),
      })),
    })),
  };
}

// ---- Days, in the store's time zone -------------------------------------------------------------
export const manilaDay = (at: Date) => at.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

/** "YYYY-MM-DD" n days before `day`. */
export function daysBefore(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! - n));
  return date.toISOString().slice(0, 10);
}

export type RangeKey = 'today' | 'yesterday' | 'week' | 'all';

/** The board's chips: Today, Yesterday, This week (the last 7 days), All 30 days. */
export function rangeFor(key: RangeKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = daysBefore(today, 1);
      return { from: day, to: day };
    }
    case 'week':
      return { from: daysBefore(today, 6), to: today };
    default:
      return { from: daysBefore(today, 29), to: today };
  }
}

/** "Today", "Yesterday", or "Mon, Nov 9". */
export function dayHeading(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === daysBefore(today, 1)) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 4)).toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ---- Calls ----------------------------------------------------------------------------------------
export async function fetchHistory(args: {
  from: string;
  to: string;
  salesperson?: string | null;
  before?: { at: Date; id: string } | null;
  limit?: number;
}): Promise<HistoryPage> {
  const { data, error } = await supabase.rpc('sales_history', {
    p_from: args.from,
    p_to: args.to,
    p_salesperson: args.salesperson ?? null,
    p_before: args.before ? args.before.at.toISOString() : null,
    p_before_id: args.before?.id ?? null,
    p_limit: args.limit ?? 50,
  });
  if (error) throw error;
  return toHistoryPage(data);
}

export async function fetchSaleDetail(saleId: string): Promise<SaleDetail> {
  const { data, error } = await supabase.rpc('sale_detail', { p_sale_id: saleId });
  if (error) throw error;
  return toSaleDetail(data);
}

export interface HistoryState {
  sales: HistorySale[];
  days: HistoryDay[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * One range of sales, a page at a time. Loads again when the range or salesperson changes,
 * and when the screen comes back into view. Needs internet: history is read from the server.
 */
export function useSalesHistory(
  from: string,
  to: string,
  salesperson: string | null,
): HistoryState {
  // Which query the shown rows belong to: a different one means it is still loading.
  const key = `${from}|${to}|${salesperson ?? ''}`;
  const [state, setState] = useState<
    Omit<HistoryState, 'loadMore' | 'reload' | 'loading'> & { key: string | null }
  >({ key: null, sales: [], days: [], hasMore: false, loadingMore: false, error: false });
  const run = useRef(0);

  const reload = useCallback(() => {
    const mine = ++run.current;
    fetchHistory({ from, to, salesperson }).then(
      (page) => {
        if (mine !== run.current) return;
        setState({
          key: `${from}|${to}|${salesperson ?? ''}`,
          sales: page.sales,
          days: page.days,
          hasMore: page.hasMore,
          loadingMore: false,
          error: false,
        });
      },
      () => {
        if (mine !== run.current) return;
        setState((current) => ({ ...current, error: true }));
      },
    );
  }, [from, to, salesperson]);

  const loadMore = useCallback(() => {
    const last = state.sales.at(-1);
    if (!last || state.loadingMore) return;
    const mine = run.current;
    setState((current) => ({ ...current, loadingMore: true }));
    fetchHistory({ from, to, salesperson, before: { at: last.madeAt, id: last.id } }).then(
      (page) => {
        if (mine !== run.current) return;
        setState((current) => ({
          ...current,
          sales: [...current.sales, ...page.sales],
          hasMore: page.hasMore,
          loadingMore: false,
        }));
      },
      () => {
        if (mine !== run.current) return;
        setState((current) => ({ ...current, loadingMore: false, error: true }));
      },
    );
  }, [from, to, salesperson, state.sales, state.loadingMore]);

  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const current = state.key === key;
  return {
    sales: current ? state.sales : [],
    days: current ? state.days : [],
    hasMore: current && state.hasMore,
    loading: !current && !state.error,
    loadingMore: state.loadingMore,
    error: state.error,
    loadMore,
    reload,
  };
}
