import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';
import type { Category, Product } from './data';

/**
 * PROD-06: the Owner's product list as CSV, for Excel. UTF-8 with a byte order mark, so Excel
 * keeps ₱ and ñ; CRLF line ends; numbers plain (no ₱, no thousands separators) so they stay
 * numbers. Text that Excel would read as a formula (=, +, -, @) gets a leading apostrophe.
 */
// The byte order mark that tells Excel the file is UTF-8.
export const BOM = String.fromCharCode(0xfeff);

export const CSV_HEADERS = [
  'SKU',
  'Name',
  'Category',
  'Unit',
  'Price',
  'Reorder level',
  'Active',
  'Stock on hand',
  'Average cost',
];

/** One CSV field: a number as is, text quoted when it needs to be. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * A SKU of only digits and dashes would become a number ("00123" → 123) or a date ("12-5")
 * in Excel; ="00123" keeps it as typed.
 */
export const skuCell = (sku: string) => (/^[\d-]+$/.test(sku) ? `"=""${sku}"""` : csvCell(sku));

export function productsCsv(
  products: Product[],
  categories: Category[],
  costs: Map<string, number>,
): string {
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const rows = products.map((product) => {
    const cost = costs.get(product.id);
    return [
      skuCell(product.sku),
      ...[
        product.name,
        categoryName.get(product.categoryId) ?? '',
        product.unit,
        product.sellPrice.toFixed(2),
        product.reorderLevel,
        product.active ? 'Yes' : 'No',
        product.stockQty,
        cost === undefined ? null : cost.toFixed(4),
      ].map((value) =>
        // Fixed-decimal numbers arrive as strings; they are numbers in the file.
        typeof value === 'string' && /^-?\d+\.\d+$/.test(value) ? value : csvCell(value),
      ),
    ].join(',');
  });
  return `${BOM}${[CSV_HEADERS.join(','), ...rows].join('\r\n')}\r\n`;
}

// The API returns at most this many rows per request (supabase/config.toml max_rows).
const PAGE = 300;

/** Every product's average cost (Owner only; Row Level Security returns nothing to others). */
async function loadCosts(): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('product_costs')
      .select('product_id, cost_price')
      .order('product_id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data as { product_id: string; cost_price: number | string }[]) {
      costs.set(row.product_id, Number(row.cost_price));
    }
    if (data.length < PAGE) return costs;
  }
}

/** products-2026-10-27.csv, in the store's time zone. */
export const exportFileName = (now = new Date()) =>
  `products-${now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })}.csv`;

export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Builds and saves the file, then records the export in the audit log. */
export async function exportProducts(products: Product[], categories: Category[]): Promise<void> {
  const costs = await loadCosts();
  download(exportFileName(), productsCsv(products, categories, costs));
  const { error } = await supabase.rpc('record_product_export', {
    p_rows: products.length,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}
