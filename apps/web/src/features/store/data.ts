import { createContext, useContext } from 'react';
import type { QueryState } from '@/hooks/useLiveRows';
import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';

export type LateDeduction = 'none' | 'minutes' | 'flat';

/** The branch row as the app uses it: store settings (SYS-01) and attendance rules (ATT-07). */
export interface BranchSettings {
  id: string;
  name: string;
  address: string | null;
  contact: string | null;
  tin: string | null;
  receiptFooter: string | null;
  /** POS-07: when on, the slip shows the VAT part of the VAT-inclusive total. Off by default. */
  vatRegistered: boolean;
  /** Percent, for example 12; each sale keeps the rate it was made at. */
  vatRate: number;
  /** POS-04: round the cash part of a sale to the nearest peso. On by default. */
  roundCash: boolean;
  idleLockMinutes: number;
  /** Both null until the Owner sets the store's location: the clock-in check is off (ATT-02). */
  storeLat: number | null;
  storeLng: number | null;
  radiusM: number;
  /** "HH:MM", Manila time (ATT-06). */
  morningClockIn: string;
  afternoonClockIn: string;
  graceMinutes: number;
  lateDeduction: LateDeduction;
  /** Pesos per late day, used when lateDeduction is "flat". */
  latePenalty: number;
  /** Used when lateDeduction is "minutes": daily rate / this x minutes late. */
  paidMinutesPerDay: number;
  /** ATT-10: 0.5 (half day) or 1 (full day) for a day starting with the afternoon shift. */
  afternoonDayCredit: 0.5 | 1;
  ownerClocksIn: boolean;
}

type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** "06:00:00" from the database as "06:00". */
const hhmm = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : fallback;

export const toBranch = (row: Row): BranchSettings => ({
  id: String(row.id ?? ''),
  name: String(row.name ?? ''),
  address: text(row.address),
  contact: text(row.contact),
  tin: text(row.tin),
  receiptFooter: text(row.receipt_footer),
  vatRegistered: row.vat_registered === true,
  vatRate: num(row.vat_rate) ?? 12,
  roundCash: row.round_cash !== false,
  idleLockMinutes: num(row.idle_lock_minutes) ?? 15,
  storeLat: num(row.store_lat),
  storeLng: num(row.store_lng),
  radiusM: num(row.radius_m) ?? 100,
  morningClockIn: hhmm(row.morning_clock_in, '06:00'),
  afternoonClockIn: hhmm(row.afternoon_clock_in, '13:00'),
  graceMinutes: num(row.grace_minutes) ?? 15,
  lateDeduction:
    row.late_deduction === 'minutes' || row.late_deduction === 'flat' ? row.late_deduction : 'none',
  latePenalty: num(row.late_penalty) ?? 0,
  paidMinutesPerDay: num(row.paid_minutes_per_day) ?? 480,
  afternoonDayCredit: num(row.afternoon_day_credit) === 1 ? 1 : 0.5,
  ownerClocksIn: row.owner_clocks_in === true,
});

// One string literal, so supabase-js can type the row it returns.
const COLUMNS =
  'id, name, address, contact, tin, receipt_footer, vat_registered, vat_rate, round_cash, idle_lock_minutes, store_lat, store_lng, radius_m, morning_clock_in, afternoon_clock_in, grace_minutes, late_deduction, late_penalty, paid_minutes_per_day, afternoon_day_credit, owner_clocks_in';

/**
 * The signed-in user's branch, live. Row Level Security returns it only to the branch's own
 * active users; anyone else gets nothing.
 */
export function useBranchQuery(branchId: string | undefined): QueryState<BranchSettings> {
  return useLiveRows({
    table: 'branches',
    queryKey: branchId ?? '',
    load: () =>
      branchId
        ? supabase.from('branches').select(COLUMNS).eq('id', branchId).limit(1)
        : Promise.resolve({ data: [], error: null }),
    map: toBranch,
    filter: branchId ? `id=eq.${branchId}` : undefined,
  });
}

const EMPTY: QueryState<BranchSettings> = { data: [], loading: true, error: false };

/** Loaded once in ProtectedLayout and shared, so every screen uses the same live row. */
export const BranchContext = createContext<QueryState<BranchSettings>>(EMPTY);

export function useBranch(): { branch: BranchSettings | null; loading: boolean; error: boolean } {
  const state = useContext(BranchContext);
  return { branch: state.data[0] ?? null, loading: state.loading, error: state.error };
}

/** Database column names, as update_branch_settings takes them. */
export interface BranchChanges {
  name?: string;
  address?: string | null;
  contact?: string | null;
  tin?: string | null;
  receipt_footer?: string | null;
  vat_registered?: boolean;
  vat_rate?: number;
  round_cash?: boolean;
  idle_lock_minutes?: number;
  store_lat?: number | null;
  store_lng?: number | null;
  radius_m?: number;
  morning_clock_in?: string;
  afternoon_clock_in?: string;
  grace_minutes?: number;
  late_deduction?: LateDeduction;
  late_penalty?: number;
  paid_minutes_per_day?: number;
  afternoon_day_credit?: 0.5 | 1;
  owner_clocks_in?: boolean;
}

/** SYS-01: the Owner saves some settings. The server checks, saves and audit-logs them. */
export async function updateBranchSettings(changes: BranchChanges): Promise<void> {
  const { error } = await supabase.rpc('update_branch_settings', {
    p_changes: changes,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

export function describeSaveError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code === '42501') return 'Only the Owner can change store settings.';
  if (message === 'invalid_input') return 'Some details are not valid. Check the form.';
  if (message === 'name_taken') {
    return 'Another payment account already has this label. If it is inactive, reactivate it instead.';
  }
  if (message === 'not_found') return 'This payment account no longer exists. Reload the page.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. Settings need to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}

export type PaymentProvider = 'gcash' | 'maya';

export const PROVIDER_LABELS: Record<PaymentProvider, string> = { gcash: 'GCash', maya: 'Maya' };

/** POS-04: one of the store's GCash or Maya accounts. Deactivated, never deleted. */
export interface PaymentAccount {
  id: string;
  provider: PaymentProvider;
  label: string;
  number: string;
  active: boolean;
}

const toPaymentAccount = (row: Row): PaymentAccount => ({
  id: String(row.id ?? ''),
  provider: row.provider === 'maya' ? 'maya' : 'gcash',
  label: String(row.label ?? ''),
  number: String(row.number ?? ''),
  active: row.active !== false,
});

/** Active first, then GCash before Maya, then by label. */
export const sortAccounts = (accounts: PaymentAccount[]) =>
  [...accounts].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.provider.localeCompare(b.provider) ||
      a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }),
  );

/** The branch's payment accounts, live. Everyone in the branch reads them (they pick one). */
export function usePaymentAccounts() {
  return useLiveRows({
    table: 'payment_accounts',
    queryKey: 'all',
    load: () =>
      supabase.from('payment_accounts').select('id, provider, label, number, active').limit(100),
    map: toPaymentAccount,
  });
}

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, { ...args, p_device_tag: getDeviceTag() });
  if (error) throw error;
  return data;
}

/** The Owner adds an account. The server trims, checks and audit-logs it. */
export const createPaymentAccount = (fields: {
  provider: PaymentProvider;
  label: string;
  number: string;
}) => call('create_payment_account', { p_fields: fields }).then(String);

/** The Owner changes the label or number, or deactivates or reactivates an account. */
export const updatePaymentAccount = (
  id: string,
  changes: { label?: string; number?: string; active?: boolean },
) => call('update_payment_account', { p_id: id, p_changes: changes }).then(() => undefined);
