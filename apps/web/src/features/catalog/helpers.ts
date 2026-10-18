import type { Product, ProductFields } from './data';
import type { ProductValues } from './schemas';

export const selectClass =
  'min-h-[48px] w-full rounded-[14px] border border-divider bg-bg px-[12px] text-[15px] text-text hover:border-text/45';

export const toFields = (values: ProductValues): ProductFields => ({
  sku: values.sku,
  name: values.name,
  category_id: values.categoryId,
  unit: values.unit,
  sell_price: Number(values.sellPrice),
  reorder_level: Number(values.reorderLevel),
});

/** Name or SKU contains the search, ignoring case. Fuzzy search comes with checkout. */
export function matchesSearch(product: Product, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term);
}
