import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';

/** SRS 3.2: a product category. Never deleted; an inactive one stays on old products. */
export interface Category {
  id: string;
  name: string;
  active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
}

type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

const toCategory = (row: Row): Category => ({
  id: String(row.id ?? ''),
  name: String(row.name ?? ''),
  active: row.active !== false,
});

const toSupplier = (row: Row): Supplier => ({
  id: String(row.id ?? ''),
  name: String(row.name ?? ''),
  contactPerson: text(row.contact_person),
  phone: text(row.phone),
  address: text(row.address),
  active: row.active !== false,
});

/** Active first, then by name, ignoring case. */
export function sortByActiveThenName<T extends { name: string; active: boolean }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );
}

/** The branch's categories, live. Every active user of the branch may read them. */
export function useCategories() {
  return useLiveRows({
    table: 'categories',
    queryKey: 'all',
    load: () => supabase.from('categories').select('id, name, active').limit(500),
    map: toCategory,
  });
}

/** The branch's suppliers, live. Row Level Security shows them to the Owner and Special Sales. */
export function useSuppliers() {
  return useLiveRows({
    table: 'suppliers',
    queryKey: 'all',
    load: () =>
      supabase
        .from('suppliers')
        .select('id, name, contact_person, phone, address, active')
        .limit(500),
    map: toSupplier,
  });
}

async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, { ...args, p_device_tag: getDeviceTag() });
  if (error) throw error;
}

export const createCategory = (name: string) => call('create_category', { p_name: name });

export const updateCategory = (id: string, changes: { name?: string; active?: boolean }) =>
  call('update_category', { p_id: id, p_changes: changes });

export interface SupplierFields {
  name: string;
  contact_person: string;
  phone: string;
  address: string;
}

export const createSupplier = (fields: SupplierFields) =>
  call('create_supplier', { p_fields: fields });

export const updateSupplier = (
  id: string,
  changes: Partial<SupplierFields> & { active?: boolean },
) => call('update_supplier', { p_id: id, p_changes: changes });

/** The server's error codes as a sentence. `what` is "category" or "supplier". */
export function describeCatalogError(error: unknown, what: 'category' | 'supplier'): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (message === 'name_taken') {
    return `A ${what} with this name already exists. If it is inactive, reactivate it instead.`;
  }
  if (message === 'invalid_input') return 'Some details are not valid. Check the form.';
  if (message === 'not_found') return `This ${what} no longer exists. Reload the page.`;
  if (code === '42501') return `Only the Owner can change a ${what}.`;
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. This needs to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
