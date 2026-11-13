import { BOM, csvCell } from '@/features/catalog/export';
import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
import { formatPeso } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { REASON_LABELS, type EntryReason, type EntryType } from './data';

/** SHIFT-04: one day's drawer, as the Owner reads it (Row Level Security: the Owner only). */
export interface DrawerRecord {
  id: string;
  businessDate: string;
  status: 'open' | 'closed' | 'not_counted';
  openedByName: string;
  openedAt: Date;
  openingCash: number;
  prefillCash: number | null;
  prefillDifference: number | null;
  openingReason: string | null;
  closedByName: string | null;
  closedAt: Date | null;
  countedCash: number | null;
  expectedCash: number | null;
  overShort: number | null;
  closingNote: string | null;
}

export interface DrawerEntryRecord {
  id: string;
  type: EntryType;
  amount: number;
  reason: EntryReason;
  note: string | null;
  userName: string;
  createdAt: Date;
}

/** A close or reopen of one drawer, from the audit log: a reopen clears the drawer's closing. */
export interface DrawerEvent {
  id: string;
  kind: 'closed' | 'reopened';
  at: Date;
  by: string;
  counted: number | null;
  overShort: number | null;
  /** The closing note, or the reason for the reopen. */
  note: string | null;
}

type Row = Record<string, unknown>;

const money = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
const when = (value: unknown) => (value ? new Date(String(value)) : null);

const toRecord = (row: Row): DrawerRecord => ({
  id: String(row.id),
  businessDate: String(row.business_date),
  status: row.status as DrawerRecord['status'],
  openedByName: String(row.opened_by_name ?? ''),
  openedAt: new Date(String(row.opened_at)),
  openingCash: Number(row.opening_cash ?? 0),
  prefillCash: money(row.prefill_cash),
  prefillDifference: money(row.prefill_difference),
  openingReason: text(row.opening_reason),
  closedByName: text(row.closed_by_name),
  closedAt: when(row.closed_at),
  countedCash: money(row.counted_cash),
  expectedCash: money(row.expected_cash),
  overShort: money(row.over_short),
  closingNote: text(row.closing_note),
});

const toEntry = (row: Row): DrawerEntryRecord => ({
  id: String(row.id),
  type: row.type as EntryType,
  amount: Number(row.amount ?? 0),
  reason: row.reason as EntryReason,
  note: text(row.note),
  userName: String(row.user_name ?? ''),
  createdAt: new Date(String(row.created_at)),
});

const SESSION_COLUMNS =
  'id, business_date, status, opened_by_name, opened_at, opening_cash, prefill_cash, prefill_difference, opening_reason, closed_by_name, closed_at, counted_cash, expected_cash, over_short, closing_note';

/** The drawer of one business day ("YYYY-MM-DD"), live. */
export function useDrawerDay(day: string) {
  return useLiveRows({
    table: 'drawer_sessions',
    queryKey: day,
    load: () =>
      supabase.from('drawer_sessions').select(SESSION_COLUMNS).eq('business_date', day).limit(1),
    map: toRecord,
    filter: `business_date=eq.${day}`,
  });
}

/** The store's latest drawer: only it can be reopened. */
export function useLatestDrawer() {
  return useLiveRows({
    table: 'drawer_sessions',
    queryKey: 'latest',
    load: () =>
      supabase
        .from('drawer_sessions')
        .select('id, business_date, status')
        .order('business_date', { ascending: false })
        .limit(1),
    map: (row: Row) => ({ id: String(row.id), businessDate: String(row.business_date) }),
  });
}

/** One drawer's cash in and out, oldest first, live. */
export function useDrawerEntries(sessionId: string | undefined) {
  return useLiveRows({
    table: 'drawer_entries',
    queryKey: sessionId ?? '',
    load: () =>
      sessionId
        ? supabase
            .from('drawer_entries')
            .select('id, type, amount, reason, note, user_name, created_at')
            .eq('session_id', sessionId)
            .order('created_at')
            .limit(300)
        : Promise.resolve({ data: [], error: null }),
    map: toEntry,
    filter: sessionId ? `session_id=eq.${sessionId}` : undefined,
  });
}

const toEvent = (row: Row): DrawerEvent => {
  const after = (row.after ?? {}) as Row;
  const actor = (row.actor ?? {}) as Row;
  return {
    id: String(row.id),
    kind: row.action === 'drawer.reopen' ? 'reopened' : 'closed',
    at: new Date(String(row.created_at)),
    by: String(actor.display_name ?? ''),
    counted: money(after.counted),
    overShort: money(after.overShort),
    note: text(row.reason),
  };
};

/**
 * Every close and reopen of one drawer, oldest first. Reads the audit log, and loads again
 * when the drawer's own row changes: each close and reopen changes it in the same transaction.
 */
export function useDrawerEvents(sessionId: string | undefined) {
  return useLiveRows({
    table: 'drawer_sessions',
    queryKey: sessionId ?? '',
    load: () =>
      sessionId
        ? supabase
            .from('audit_logs')
            .select('id, action, after, reason, created_at, actor:profiles!actor_id(display_name)')
            .eq('target_type', 'drawer')
            .eq('target_id', sessionId)
            .in('action', ['drawer.close', 'drawer.reopen'])
            .order('created_at')
            .limit(100)
        : Promise.resolve({ data: [], error: null }),
    map: toEvent,
    filter: sessionId ? `id=eq.${sessionId}` : undefined,
  });
}

export type SaleFlag =
  | 'price_changed'
  | 'settings_changed'
  | 'product_inactive'
  | 'discount_changed'
  | 'deal_changed'
  | 'stock_negative'
  | 'duplicate_reference'
  | 'late'
  | 'clock_ahead';

/** What each flag tells the Owner (POS-09, POS-13, POS-14). */
export const FLAG_LABELS: Record<SaleFlag, string> = {
  late: 'Late: made on an earlier day',
  price_changed: "Price differed from the store's",
  settings_changed: 'Rounding or VAT setting differed',
  product_inactive: 'Product was turned off',
  discount_changed: 'Discount differed from the preset',
  deal_changed: 'Deal no longer added up',
  stock_negative: 'Stock went below zero',
  duplicate_reference: 'Reference used on another sale',
  clock_ahead: "Phone's clock was ahead",
};

export interface FlaggedSale {
  id: string;
  receiptNo: string;
  salesperson: string;
  /** By the phone's clock. */
  madeAt: Date;
  /** When the store got it. */
  syncedAt: Date;
  total: number;
  flags: SaleFlag[];
  madeOffline: boolean;
}

/** SHIFT-04: one drawer's sales, summed on the server (the Owner only). */
export interface DrawerSales {
  count: number;
  total: number;
  /** What the preset discounts took off (POS-03). */
  discounts: number;
  /** Cash is what went into the drawer; a split sale counts under each of its methods. */
  methods: { method: 'cash' | 'gcash' | 'maya'; count: number; amount: number }[];
  salespeople: { name: string; count: number; total: number }[];
  flaggedCount: number;
  /** The first 200 flagged sales, oldest first. */
  flagged: FlaggedSale[];
}

const toDrawerSales = (row: Row): DrawerSales => ({
  count: Number(row.count ?? 0),
  total: Number(row.total ?? 0),
  discounts: Number(row.discounts ?? 0),
  methods: ((row.methods ?? []) as Row[]).map((m) => ({
    method: m.method as DrawerSales['methods'][number]['method'],
    count: Number(m.count ?? 0),
    amount: Number(m.amount ?? 0),
  })),
  salespeople: ((row.salespeople ?? []) as Row[]).map((p) => ({
    name: String(p.name ?? ''),
    count: Number(p.count ?? 0),
    total: Number(p.total ?? 0),
  })),
  flaggedCount: Number(row.flaggedCount ?? 0),
  flagged: ((row.flagged ?? []) as Row[]).map((f) => ({
    id: String(f.id),
    receiptNo: String(f.receiptNo ?? ''),
    salesperson: String(f.salesperson ?? ''),
    madeAt: new Date(String(f.madeAt)),
    syncedAt: new Date(String(f.syncedAt)),
    total: Number(f.total ?? 0),
    flags: (f.flags ?? []) as SaleFlag[],
    madeOffline: f.madeOffline === true,
  })),
});

/** The amount paid by one method, 0 when none. */
export const paidBy = (sales: DrawerSales | null, method: 'cash' | 'gcash' | 'maya') =>
  sales?.methods.find((m) => m.method === method)?.amount ?? 0;

/**
 * One drawer's sales summary, loaded again whenever one of its sales arrives or changes (a sale
 * made offline joins when it syncs). One small answer from `drawer_sales`, not every sale.
 */
export function useDrawerSales(sessionId: string | undefined) {
  return useLiveRows({
    table: 'sales',
    queryKey: sessionId ?? '',
    load: () =>
      sessionId
        ? supabase
            .rpc('drawer_sales', { p_session_id: sessionId })
            .then(({ data, error }) => ({ data: data ? [data as Row] : null, error }))
        : Promise.resolve({ data: [], error: null }),
    map: toDrawerSales,
    filter: sessionId ? `session_id=eq.${sessionId}` : undefined,
  });
}

/**
 * Opening + cash sales + cash in − cash out: what the drawer should hold, as the server works
 * it out (refunds and utang payments join later).
 */
export function expectedFrom(record: DrawerRecord, entries: DrawerEntryRecord[], cashSales = 0) {
  const cashIn = entries.filter((e) => e.type === 'cash_in').reduce((s, e) => s + e.amount, 0);
  const cashOut = entries.filter((e) => e.type === 'cash_out').reduce((s, e) => s + e.amount, 0);
  return {
    cashIn,
    cashOut,
    cashSales,
    expected: record.openingCash + cashSales + cashIn - cashOut,
  };
}

/** The Owner only, with a reason: the latest drawer opens again (SHIFT-01). */
export async function reopenDrawer(sessionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_drawer', {
    p_session_id: sessionId,
    p_reason: reason,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

export interface Movement {
  at: Date | null;
  kind: 'opened' | EntryType | 'closed' | 'reopened' | 'not_counted';
  type: string;
  note: string;
  by: string;
  /** Pesos, signed for cash in and out; null when there is no amount. */
  amount: number | null;
}

const closeResult = (overShort: number | null) =>
  overShort === null
    ? ''
    : overShort === 0
      ? 'Exact'
      : `${overShort < 0 ? 'Short' : 'Over'} ${formatPeso(Math.abs(overShort))}`;

/**
 * A reopened drawer nobody recounted: the result of its last count, so a shortage doesn't
 * drop out of the headline. Null for any other drawer.
 */
export function earlierCount(record: DrawerRecord, events: DrawerEvent[]): string | null {
  if (record.status !== 'not_counted') return null;
  const last = events.filter((event) => event.kind === 'closed').pop();
  if (!last || last.overShort === null) return null;
  return `Earlier count before the reopen: ${closeResult(last.overShort).toLowerCase()}`;
}

const noteOf = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');

/** "Closed when Test Special 5 opened Nov 13's drawer": who closed it, without counting it. */
function notCountedNote(record: DrawerRecord): string {
  if (!record.closedByName) return 'Closed when the next drawer opened';
  const day = record.closedAt
    ? record.closedAt.toLocaleDateString('en-PH', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
      })
    : null;
  return day
    ? `Closed when ${record.closedByName} opened ${day}'s drawer`
    : `Closed when ${record.closedByName} opened the next drawer`;
}

/**
 * The day in time order, as the report's table and the CSV show it: every close and reopen
 * included, so a count that a reopen set aside stays visible.
 */
export function movements(
  record: DrawerRecord,
  entries: DrawerEntryRecord[],
  events: DrawerEvent[] = [],
): Movement[] {
  const list: Movement[] = [
    {
      at: record.openedAt,
      kind: 'opened',
      type: 'Opened',
      note: record.openingReason ?? '',
      by: record.openedByName,
      amount: record.openingCash,
    },
    ...entries.map((entry) => ({
      at: entry.createdAt,
      kind: entry.type,
      type: entry.type === 'cash_in' ? 'Cash in' : 'Cash out',
      note: [REASON_LABELS[entry.reason], entry.note].filter(Boolean).join(' · '),
      by: entry.userName,
      amount: entry.type === 'cash_in' ? entry.amount : -entry.amount,
    })),
    ...events.map((event) =>
      event.kind === 'reopened'
        ? {
            at: event.at,
            kind: event.kind,
            type: 'Reopened',
            note: event.note ? `Reason: ${event.note}` : '',
            by: event.by,
            amount: null,
          }
        : {
            at: event.at,
            kind: event.kind,
            type: 'Closed',
            note: noteOf(closeResult(event.overShort), event.note),
            by: event.by,
            amount: event.counted,
          },
    ),
  ];
  // The events are still loading or failed: the drawer's own row still shows its closing.
  if (record.status === 'closed' && !events.some((event) => event.kind === 'closed')) {
    list.push({
      at: record.closedAt,
      kind: 'closed',
      type: 'Closed',
      note: noteOf(closeResult(record.overShort), record.closingNote),
      by: record.closedByName ?? '',
      amount: record.countedCash,
    });
  } else if (record.status === 'not_counted') {
    list.push({
      at: record.closedAt,
      kind: 'not_counted',
      type: 'Not counted',
      // Nobody counted it: the person named here only opened the next day's drawer.
      note: notCountedNote(record),
      by: '',
      amount: null,
    });
  }
  return list.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
}

export const DRAWER_CSV_HEADERS = ['Date', 'Time', 'Type', 'Reason / note', 'By', 'Amount'];

/** The CSV's closing lines: expected, counted and over/short, so the file reads on its own. */
export function drawerSummary(
  record: DrawerRecord,
  entries: DrawerEntryRecord[],
  events: DrawerEvent[] = [],
  sales: DrawerSales | null = null,
): { type: string; note: string; amount: number | null }[] {
  const expected =
    record.expectedCash ?? expectedFrom(record, entries, paidBy(sales, 'cash')).expected;
  const counted = record.status === 'closed' ? record.countedCash : null;
  const overShort = record.status === 'closed' ? record.overShort : null;
  const missing =
    record.status === 'not_counted' ? 'Not counted' : record.status === 'open' ? 'Still open' : '';
  const salesLines = sales
    ? [
        {
          type: 'Sales',
          note: `${sales.count} ${sales.count === 1 ? 'sale' : 'sales'}`,
          amount: sales.total,
        },
        ...(sales.discounts > 0
          ? [
              {
                type: 'Discounts given',
                note: 'Preset discounts and deals',
                amount: sales.discounts,
              },
            ]
          : []),
        { type: 'Cash sales', note: 'In the drawer', amount: paidBy(sales, 'cash') },
        { type: 'GCash', note: 'Not in the drawer', amount: paidBy(sales, 'gcash') },
        { type: 'Maya', note: 'Not in the drawer', amount: paidBy(sales, 'maya') },
        ...sales.salespeople.map((person) => ({
          type: `Sold by ${person.name}`,
          note: `${person.count} ${person.count === 1 ? 'sale' : 'sales'}`,
          amount: person.total,
        })),
        ...sales.flagged.map((sale) => ({
          type: `Check ${sale.receiptNo}`,
          note: noteOf(sale.salesperson, sale.flags.map((flag) => FLAG_LABELS[flag]).join(', ')),
          amount: sale.total,
        })),
      ]
    : [];
  return [
    ...salesLines,
    { type: 'Expected', note: record.status === 'open' ? 'So far' : '', amount: expected },
    { type: 'Counted', note: counted === null ? missing : '', amount: counted },
    {
      type: 'Over/short',
      note:
        overShort === null
          ? noteOf(missing, earlierCount(record, events))
          : overShort === 0
            ? 'Exact'
            : overShort < 0
              ? 'Short'
              : 'Over',
      amount: overShort,
    },
  ];
}

/** SHIFT-04: the day's movements as CSV for Excel, like the product export. */
export function drawerCsv(
  record: DrawerRecord,
  entries: DrawerEntryRecord[],
  events: DrawerEvent[] = [],
  sales: DrawerSales | null = null,
): string {
  const summary = drawerSummary(record, entries, events, sales).map((line) =>
    [
      csvCell(record.businessDate),
      '',
      csvCell(line.type),
      csvCell(line.note),
      '',
      line.amount === null ? '' : line.amount.toFixed(2),
    ].join(','),
  );
  const rows = movements(record, entries, events).map((move) =>
    [
      csvCell(record.businessDate),
      csvCell(
        move.at
          ? move.at.toLocaleTimeString('en-PH', {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'Asia/Manila',
            })
          : '',
      ),
      csvCell(move.type),
      csvCell(move.note),
      csvCell(move.by),
      move.amount === null ? '' : move.amount.toFixed(2),
    ].join(','),
  );
  return `${BOM}${[DRAWER_CSV_HEADERS.join(','), ...rows, ...summary].join('\r\n')}\r\n`;
}
