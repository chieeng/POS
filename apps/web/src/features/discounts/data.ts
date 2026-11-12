import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';
import type { DiscountKind, DiscountRule, DiscountTarget } from './rules';

type Row = Record<string, unknown>;

const ids = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

const toRule = (row: Row): DiscountRule => ({
  id: String(row.id ?? ''),
  name: String(row.name ?? ''),
  kind: row.kind === 'fixed' ? 'fixed' : 'percent',
  value: Number(row.value ?? 0),
  appliesTo:
    row.applies_to === 'categories' || row.applies_to === 'products' ? row.applies_to : 'all',
  categoryIds: ids(row.category_ids),
  productIds: ids(row.product_ids),
  active: row.active !== false,
});

/** Active first, then by name. */
export const sortRules = (rules: DiscountRule[]) =>
  [...rules].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );

/**
 * The branch's preset discounts, live: a handful of rows that change rarely, so watching them
 * costs few Realtime messages. Everyone in the branch reads them (staff pick one).
 */
export function useDiscounts() {
  return useLiveRows({
    table: 'discounts',
    queryKey: 'all',
    load: () =>
      supabase
        .from('discounts')
        .select('id, name, kind, value, applies_to, category_ids, product_ids, active')
        .limit(200),
    map: toRule,
  });
}

export interface DiscountFields {
  name: string;
  kind: DiscountKind;
  value: number;
  applies_to: DiscountTarget;
  category_ids: string[];
  product_ids: string[];
}

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, { ...args, p_device_tag: getDeviceTag() });
  if (error) throw error;
  return data;
}

/** The Owner adds a preset. The server checks and audit-logs it. */
export const createDiscount = (fields: DiscountFields) =>
  call('create_discount', { p_fields: fields }).then(String);

/** The Owner changes a preset, or switches it off or on. */
export const updateDiscount = (
  id: string,
  changes: Partial<DiscountFields> & { active?: boolean },
) => call('update_discount', { p_id: id, p_changes: changes }).then(() => undefined);

export function describeDiscountError(error: unknown): string {
  const { message } = (error ?? {}) as { message?: unknown };
  if (message === 'name_taken') return 'Another discount already has this name.';
  if (message === 'not_found')
    return 'A product or category was removed meanwhile. Reload the page.';
  if (message === 'invalid_input') return 'Check the amount and what it applies to.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. Settings need to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
