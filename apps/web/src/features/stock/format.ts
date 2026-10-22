import type { StockReceipt } from './data';

export const formatWhen = (when: Date) =>
  when.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** What a stock-in cost: the sum of quantity x unit cost over its lines. */
export const receiptTotal = (receipt: StockReceipt) =>
  receipt.lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
