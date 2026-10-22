/** The lines of a stock-in being typed (NewStockInPage). */
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

export const QTY = /^\d{1,6}$/;
export const COST = /^\d{1,7}(\.\d{1,2})?$/;

export function lineProblem(line: Line): string | null {
  if (!QTY.test(line.qty.trim()) || Number(line.qty) < 1 || Number(line.qty) > 100_000) {
    return `${line.name}: enter a whole quantity of at least 1.`;
  }
  const cost = line.cost.trim();
  if (!COST.test(cost) || Number(cost) < 0.01 || Number(cost) > 1_000_000) {
    return `${line.name}: enter the unit cost in pesos, at least ₱0.01.`;
  }
  return null;
}
