/** The lines of a stock-in being typed (NewStockInPage). */
import { MAX_QTY, minQty, parseQty, qtyRule } from '@/lib/quantity';

export const OPENING_STOCK = 'Opening stock';
export const MAX_LINES = 100;

export interface Line {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  qty: string;
  cost: string;
}

export const COST = /^\d{1,7}(\.\d{1,2})?$/;

/** A line's quantity (whole, or up to 3 decimals for kg and L), or null if it is not one. */
export const lineQty = (line: Pick<Line, 'qty' | 'unit'>) => parseQty(line.qty, line.unit);

export function lineProblem(line: Line): string | null {
  const qty = lineQty(line);
  if (qty === null || qty < minQty(line.unit) || qty > MAX_QTY) {
    return `${line.name}: ${qtyRule(line.unit)}`;
  }
  const cost = line.cost.trim();
  if (!COST.test(cost) || Number(cost) < 0.01 || Number(cost) > 1_000_000) {
    return `${line.name}: enter the unit cost in pesos, at least ₱0.01.`;
  }
  return null;
}
