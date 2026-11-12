import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';
import type { DealKind, DealRule } from './rules';

type Row = Record<string, unknown>;

const toDeal = (row: Row): DealRule => ({
  id: String(row.id ?? ''),
  name: String(row.name ?? ''),
  kind: row.kind === 'bundle' ? 'bundle' : 'quantity',
  price: Number(row.price ?? 0),
  setSize: row.set_size === null || row.set_size === undefined ? null : Number(row.set_size),
  productIds: Array.isArray(row.product_ids) ? row.product_ids.map(String) : [],
  qtys: Array.isArray(row.qtys) ? row.qtys.map(Number) : [],
  active: row.active !== false,
});

/** Active first, then by name. */
export const sortDeals = (deals: DealRule[]) =>
  [...deals].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );

/**
 * The branch's package deals, live: a few rows that change rarely. Everyone in the branch reads
 * them (the cart offers them).
 */
export function useDeals() {
  return useLiveRows({
    table: 'deals',
    queryKey: 'all',
    load: () =>
      supabase
        .from('deals')
        .select('id, name, kind, price, set_size, product_ids, qtys, active')
        .limit(200),
    map: toDeal,
  });
}

export interface DealFields {
  name: string;
  kind: DealKind;
  price: number;
  set_size: number | null;
  product_ids: string[];
  qtys: number[];
}

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, { ...args, p_device_tag: getDeviceTag() });
  if (error) throw error;
  return data;
}

/** The Owner adds a deal. The server checks and audit-logs it. */
export const createDeal = (fields: DealFields) =>
  call('create_deal', { p_fields: fields }).then(String);

/** The Owner changes a deal (never its kind), or switches it off or on. */
export const updateDeal = (
  id: string,
  changes: Partial<Omit<DealFields, 'kind'>> & { active?: boolean },
) => call('update_deal', { p_id: id, p_changes: changes }).then(() => undefined);

export function describeDealError(error: unknown): string {
  const { message } = (error ?? {}) as { message?: unknown };
  if (message === 'name_taken') return 'Another deal already has this name.';
  if (message === 'not_found') return 'A product was removed meanwhile. Reload the page.';
  if (message === 'invalid_input')
    return 'Check the price, the counts and the products (whole units only, no kg or L).';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. Settings need to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
