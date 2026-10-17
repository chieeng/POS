import { createContext, useContext } from 'react';
import type { QueryState } from '@/hooks/useLiveRows';
import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';

/** The branch row (SYS-01) as the app uses it. Attendance rules join this in a later step. */
export interface BranchSettings {
  id: string;
  name: string;
  address: string | null;
  contact: string | null;
  tin: string | null;
  receiptFooter: string | null;
  /** Discounts up to this many pesos per sale need no approval; null: every discount does. */
  salesDiscountLimit: number | null;
  idleLockMinutes: number;
  /** Both null until the Owner sets the store's location: the clock-in check is off (ATT-02). */
  storeLat: number | null;
  storeLng: number | null;
  radiusM: number;
}

type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const toBranch = (row: Row): BranchSettings => ({
  id: String(row.id ?? ''),
  name: String(row.name ?? ''),
  address: text(row.address),
  contact: text(row.contact),
  tin: text(row.tin),
  receiptFooter: text(row.receipt_footer),
  salesDiscountLimit: num(row.sales_discount_limit),
  idleLockMinutes: num(row.idle_lock_minutes) ?? 15,
  storeLat: num(row.store_lat),
  storeLng: num(row.store_lng),
  radiusM: num(row.radius_m) ?? 100,
});

const COLUMNS =
  'id, name, address, contact, tin, receipt_footer, sales_discount_limit, idle_lock_minutes, store_lat, store_lng, radius_m';

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
  sales_discount_limit?: number | null;
  idle_lock_minutes?: number;
  store_lat?: number | null;
  store_lng?: number | null;
  radius_m?: number;
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
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. Settings need to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
