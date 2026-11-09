import type { Product } from '@/features/catalog/data';
import { matchesSearch } from '@/features/catalog/helpers';
import { formatQty, isSoldByMeasure, qtyWithUnit } from '@/lib/quantity';

/**
 * POS-01: the products to show for a search and a category. Active products only; a SKU typed
 * exactly comes first, then name order, so staff typing a code see that product on top.
 */
export function sellResults(products: Product[], search: string, categoryId: string | null) {
  const term = search.trim().toUpperCase();
  return products
    .filter(
      (product) =>
        product.active &&
        (categoryId === null || product.categoryId === categoryId) &&
        matchesSearch(product, search),
    )
    .sort((a, b) => Number(b.sku === term) - Number(a.sku === term));
}

/**
 * How many items the cart holds, as the customer counts them: 2 packs of chips are 2 items,
 * and a line sold by weight or volume (1.25 kg of rice) is 1 item.
 */
export function itemCount(
  lines: { productId: string; qty: number }[],
  unitOf: (productId: string) => string | undefined,
): number {
  return lines.reduce((sum, line) => {
    const unit = unitOf(line.productId);
    return sum + (unit === undefined || isSoldByMeasure(unit) ? 1 : line.qty);
  }, 0);
}

export type StockState = 'ok' | 'low' | 'out';

/** Out at zero or below; low at or below the reorder level, when one is set (INV-05). */
export const stockState = (stock: number, reorderLevel: number): StockState =>
  stock <= 0 ? 'out' : reorderLevel > 0 && stock <= reorderLevel ? 'low' : 'ok';

/** What a cart line leaves on the shelf, and the warning that goes with it (POS-09). */
export function lineWarning(
  product: Pick<Product, 'stockQty' | 'reorderLevel' | 'unit'>,
  qty: number,
): null | { kind: 'low' | 'neg'; text: string } {
  const after = Math.round((product.stockQty - qty) * 1000) / 1000;
  if (after < 0) {
    return {
      kind: 'neg',
      text: `Stock shows ${qtyWithUnit(product.stockQty, product.unit)} · will go to ${formatQty(after)}. Count it later.`,
    };
  }
  if (product.reorderLevel > 0 && after <= product.reorderLevel) {
    return {
      kind: 'low',
      text: `Low stock · ${qtyWithUnit(after, product.unit)} left after this sale`,
    };
  }
  return null;
}
