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

/** PROD-01: the unit a product's price and every quantity are counted in. */
export const UNITS = [
  'pc',
  'pack',
  'box',
  'bottle',
  'can',
  'sachet',
  'set',
  'pair',
  'roll',
] as const;
export type Unit = (typeof UNITS)[number];

export interface Product {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  unit: Unit;
  sellPrice: number;
  /** Changed only by stock functions (build step 4); read-only here. */
  stockQty: number;
  reorderLevel: number;
  active: boolean;
  /** PROD-07: the current photo's key (see photos.ts), or null for none. */
  photoKey: string | null;
}

/** PROD-05: one price a product has had. */
export interface PriceChange {
  id: string;
  oldPrice: number | null;
  newPrice: number;
  source: 'created' | 'owner_edit' | 'approval' | 'import';
  changedByName: string;
  createdAt: Date;
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

const toProduct = (row: Row): Product => ({
  id: String(row.id ?? ''),
  sku: String(row.sku ?? ''),
  name: String(row.name ?? ''),
  categoryId: String(row.category_id ?? ''),
  unit: (UNITS as readonly string[]).includes(String(row.unit)) ? (row.unit as Unit) : 'pc',
  sellPrice: Number(row.sell_price ?? 0),
  stockQty: Number(row.stock_qty ?? 0),
  reorderLevel: Number(row.reorder_level ?? 0),
  active: row.active !== false,
  photoKey: text(row.photo_key),
});

const toPriceChange = (row: Row): PriceChange => ({
  id: String(row.id ?? ''),
  oldPrice: row.old_price === null || row.old_price === undefined ? null : Number(row.old_price),
  newPrice: Number(row.new_price ?? 0),
  source: (row.source as PriceChange['source']) ?? 'owner_edit',
  changedByName: String(row.changed_by_name ?? ''),
  createdAt: new Date(String(row.created_at)),
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

// The API returns at most this many rows per request (supabase/config.toml max_rows).
const PAGE = 300;
// NFR-09: up to 10,000 products.
const MAX_PRODUCTS = 10_000;

/** Every product of the branch, a page at a time. */
async function loadProducts(): Promise<{ data: Row[] | null; error: unknown }> {
  const rows: Row[] = [];
  for (let from = 0; from < MAX_PRODUCTS; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select(
        'id, sku, name, category_id, unit, sell_price, stock_qty, reorder_level, active, photo_key',
      )
      .order('name')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return { data: rows, error: null };
}

/** The branch's products, live. Every active user of the branch may read them. */
export function useProducts() {
  return useLiveRows({ table: 'products', queryKey: 'all', load: loadProducts, map: toProduct });
}

/** One product's price history, newest first. Row Level Security: Owner and Special Sales. */
export function usePriceChanges(productId: string) {
  return useLiveRows({
    table: 'price_changes',
    queryKey: productId,
    load: () =>
      supabase
        .from('price_changes')
        .select('id, old_price, new_price, source, changed_by_name, created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(100),
    map: toPriceChange,
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

export interface ProductFields {
  sku: string;
  name: string;
  category_id: string;
  unit: Unit;
  sell_price: number;
  reorder_level: number;
}

/** PROD-02, PROD-03: the Owner or Special Sales adds a product. Returns its id. */
export async function createProduct(fields: ProductFields): Promise<string> {
  const { data, error } = await supabase.rpc('create_product', {
    p_fields: fields,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
  return String(data);
}

/** PROD-04: the Owner changes a product. A new price is logged on the server (PROD-05). */
export const updateProduct = (id: string, changes: Partial<ProductFields> & { active?: boolean }) =>
  call('update_product', { p_id: id, p_changes: changes });

/** The server's error codes as a sentence. */
export function describeCatalogError(
  error: unknown,
  what: 'category' | 'supplier' | 'product',
): string {
  const { code, message, details } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  if (message === 'sku_taken') return 'Another product already uses this SKU.';
  if (message === 'category_inactive') return 'This category is inactive. Choose an active one.';
  if (message === 'category_in_use') {
    const count = Number(details);
    return Number.isFinite(count) && count > 0
      ? `Move or deactivate its ${count} ${count === 1 ? 'product' : 'products'} first.`
      : 'Move or deactivate its products first.';
  }
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
