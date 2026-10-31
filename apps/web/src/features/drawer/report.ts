import { BOM, csvCell } from '@/features/catalog/export';
import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
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

/** Opening + cash in − cash out: what the drawer should hold (sales come with checkout). */
export function expectedFrom(record: DrawerRecord, entries: DrawerEntryRecord[]) {
  const cashIn = entries.filter((e) => e.type === 'cash_in').reduce((s, e) => s + e.amount, 0);
  const cashOut = entries.filter((e) => e.type === 'cash_out').reduce((s, e) => s + e.amount, 0);
  return { cashIn, cashOut, expected: record.openingCash + cashIn - cashOut };
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
  kind: 'opened' | EntryType | 'closed' | 'not_counted';
  type: string;
  note: string;
  by: string;
  /** Pesos, signed for cash in and out; null when there is no amount. */
  amount: number | null;
}

/** The day in time order, as the report's table and the CSV show it. */
export function movements(record: DrawerRecord, entries: DrawerEntryRecord[]): Movement[] {
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
  ];
  if (record.status === 'closed') {
    list.push({
      at: record.closedAt,
      kind: 'closed',
      type: 'Closed',
      note: record.closingNote ?? '',
      by: record.closedByName ?? '',
      amount: record.countedCash,
    });
  } else if (record.status === 'not_counted') {
    list.push({
      at: record.closedAt,
      kind: 'not_counted',
      type: 'Not counted',
      note: 'Closed when the next drawer opened',
      by: record.closedByName ?? '',
      amount: null,
    });
  }
  return list;
}

export const DRAWER_CSV_HEADERS = ['Date', 'Time', 'Type', 'Reason / note', 'By', 'Amount'];

/** The CSV's closing lines: expected, counted and over/short, so the file reads on its own. */
export function drawerSummary(
  record: DrawerRecord,
  entries: DrawerEntryRecord[],
): { type: string; note: string; amount: number | null }[] {
  const expected = record.expectedCash ?? expectedFrom(record, entries).expected;
  const counted = record.status === 'closed' ? record.countedCash : null;
  const overShort = record.status === 'closed' ? record.overShort : null;
  const missing =
    record.status === 'not_counted' ? 'Not counted' : record.status === 'open' ? 'Still open' : '';
  return [
    { type: 'Expected', note: record.status === 'open' ? 'So far' : '', amount: expected },
    { type: 'Counted', note: counted === null ? missing : '', amount: counted },
    {
      type: 'Over/short',
      note:
        overShort === null ? missing : overShort === 0 ? 'Exact' : overShort < 0 ? 'Short' : 'Over',
      amount: overShort,
    },
  ];
}

/** SHIFT-04: the day's movements as CSV for Excel, like the product export. */
export function drawerCsv(record: DrawerRecord, entries: DrawerEntryRecord[]): string {
  const summary = drawerSummary(record, entries).map((line) =>
    [
      csvCell(record.businessDate),
      '',
      csvCell(line.type),
      csvCell(line.note),
      '',
      line.amount === null ? '' : line.amount.toFixed(2),
    ].join(','),
  );
  const rows = movements(record, entries).map((move) =>
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
