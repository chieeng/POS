import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';

/** INV-02: one stock-in (a delivery, or "Opening stock"), with its lines. */
export interface StockReceipt {
  id: string;
  supplierId: string | null;
  reference: string | null;
  receivedByName: string;
  createdAt: Date;
  lines: ReceiptLine[];
  /** INV-04: this stock-in replaces an earlier one (a correction, or its deletion). */
  correctsReceiptId: string | null;
  isDeletion: boolean;
  correctedByName: string | null;
}

export interface ReceiptLine {
  lineNo: number;
  productId: string;
  qty: number;
  /** Shown to the Owner, and to whoever received this stock-in (they typed it). */
  unitCost: number;
}

export type MovementType =
  'stock_in' | 'stock_in_reversal' | 'adjustment' | 'sale' | 'void' | 'return' | 'count';

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  stock_in: 'Stock-in',
  stock_in_reversal: 'Stock-in corrected',
  adjustment: 'Adjustment',
  sale: 'Sale',
  void: 'Void',
  return: 'Return',
  count: 'Count',
};

/** INV-06: one line of a product's stock history. */
export interface Movement {
  id: string;
  createdAt: Date;
  type: MovementType;
  qtyChange: number;
  stockAfter: number;
  /** The Owner only; null for everyone else. */
  unitCost: number | null;
  userName: string;
  refType: string | null;
  refId: string | null;
}

type Row = Record<string, unknown>;

const toReceipt = (row: Row): StockReceipt => ({
  id: String(row.id ?? ''),
  supplierId: typeof row.supplier_id === 'string' ? row.supplier_id : null,
  reference: typeof row.reference === 'string' ? row.reference : null,
  receivedByName: String(row.received_by_name ?? ''),
  createdAt: new Date(String(row.created_at)),
  correctsReceiptId: typeof row.corrects_receipt_id === 'string' ? row.corrects_receipt_id : null,
  isDeletion: row.is_deletion === true,
  correctedByName: typeof row.corrected_by_name === 'string' ? row.corrected_by_name : null,
  lines: (Array.isArray(row.stock_receipt_items) ? (row.stock_receipt_items as Row[]) : [])
    .map((line) => ({
      lineNo: Number(line.line_no ?? 0),
      productId: String(line.product_id ?? ''),
      qty: Number(line.qty ?? 0),
      unitCost: Number(line.unit_cost ?? 0),
    }))
    .sort((a, b) => a.lineNo - b.lineNo),
});

const toMovement = (row: Row): Movement => ({
  id: String(row.id ?? ''),
  createdAt: new Date(String(row.created_at)),
  type: (row.type as MovementType) ?? 'stock_in',
  qtyChange: Number(row.qty_change ?? 0),
  stockAfter: Number(row.stock_after ?? 0),
  unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
  userName: String(row.user_name ?? ''),
  refType: typeof row.ref_type === 'string' ? row.ref_type : null,
  refId: typeof row.ref_id === 'string' ? row.ref_id : null,
});

const RECEIPT_COLUMNS =
  'id, supplier_id, reference, received_by_name, created_at, corrects_receipt_id, is_deletion, corrected_by_name, stock_receipt_items(line_no, product_id, qty, unit_cost)';

/** Stock-ins, newest first: all of the branch's for the Owner, one's own for Special Sales. */
export function useStockReceipts(count = 100) {
  return useLiveRows({
    table: 'stock_receipts',
    queryKey: String(count),
    load: () =>
      supabase
        .from('stock_receipts')
        .select(RECEIPT_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(count),
    map: toReceipt,
  });
}

/** One stock-in, together with the stock-in that corrects it, if any. */
export function useStockReceipt(id: string) {
  return useLiveRows({
    table: 'stock_receipts',
    queryKey: `one:${id}`,
    load: () =>
      supabase
        .from('stock_receipts')
        .select(RECEIPT_COLUMNS)
        .or(`id.eq.${id},corrects_receipt_id.eq.${id}`)
        .limit(2),
    map: toReceipt,
  });
}

export interface HistoryFilter {
  /** "YYYY-MM-DD", Manila days, inclusive. */
  from?: string;
  to?: string;
  type?: MovementType | '';
}

/** Manila midnight of a "YYYY-MM-DD" day, as an instant. */
export const manilaDayStart = (day: string) => new Date(`${day}T00:00:00+08:00`).toISOString();

/**
 * A product's stock history (INV-06), refreshed whenever the product's stock changes. The
 * server leaves the cost out for anyone but the Owner.
 */
export function useStockHistory(productId: string, filter: HistoryFilter) {
  const key = `${productId}:${filter.from ?? ''}:${filter.to ?? ''}:${filter.type ?? ''}`;
  return useLiveRows({
    table: 'products',
    queryKey: key,
    load: async () => {
      const to = filter.to
        ? new Date(new Date(`${filter.to}T00:00:00+08:00`).getTime() + 86_400_000).toISOString()
        : null;
      const { data, error } = await supabase.rpc('product_stock_history', {
        p_product_id: productId,
        p_from: filter.from ? manilaDayStart(filter.from) : null,
        p_to: to,
        p_type: filter.type || null,
        p_limit: 200,
      });
      return { data: (data as Row[] | null) ?? null, error };
    },
    map: toMovement,
    // A movement always changes the product's stock, so a change to this product reloads it.
    filter: `id=eq.${productId}`,
  });
}

/** INV-08: the weighted-average cost of one unit. Row Level Security: the Owner only. */
export function useProductCost(productId: string) {
  return useLiveRows({
    table: 'product_costs',
    queryKey: productId,
    load: () =>
      supabase.from('product_costs').select('cost_price').eq('product_id', productId).limit(1),
    map: (row: Row) => Number(row.cost_price ?? 0),
    filter: `product_id=eq.${productId}`,
  });
}

export interface StockInLine {
  product_id: string;
  qty: number;
  unit_cost: number;
}

/** INV-02: record a stock-in; applied at once. Returns its id. */
export async function recordStockIn(
  supplierId: string | null,
  reference: string,
  lines: StockInLine[],
): Promise<string> {
  const { data, error } = await supabase.rpc('record_stock_in', {
    p_supplier_id: supplierId,
    p_reference: reference.trim() || null,
    p_lines: lines,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
  return String(data);
}

export const ADJUSTMENT_TYPES = [
  'damage',
  'loss',
  'expiry',
  'found',
  'store_use',
  'other',
] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  damage: 'Damage',
  loss: 'Loss',
  expiry: 'Expiry',
  found: 'Found',
  store_use: 'Store use',
  other: 'Other',
};

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, { ...args, p_device_tag: getDeviceTag() });
  if (error) throw error;
  return data;
}

/** INV-04: the Owner adjusts stock directly. qty is signed: -2 takes two away. */
export const adjustStock = (productId: string, type: AdjustmentType, qty: number, reason: string) =>
  call('adjust_stock', { p_product_id: productId, p_type: type, p_qty: qty, p_reason: reason });

/** INV-04: Special Sales asks the Owner for an adjustment. */
export const requestStockAdjustment = (
  productId: string,
  type: AdjustmentType,
  qty: number,
  reason: string,
) =>
  call('request_stock_adjustment', {
    p_product_id: productId,
    p_type: type,
    p_qty: qty,
    p_reason: reason,
  });

export interface Correction {
  supplierId: string | null;
  reference: string;
  /** Every product of the stock-in once; qty 0 takes it off. Ignored when deleting. */
  lines: StockInLine[];
  delete: boolean;
  reason: string;
}

const correctionArgs = (receiptId: string, correction: Correction) => ({
  p_receipt_id: receiptId,
  p_supplier_id: correction.supplierId,
  p_reference: correction.reference.trim() || null,
  p_lines: correction.delete ? null : correction.lines,
  p_delete: correction.delete,
  p_reason: correction.reason.trim() || null,
});

/** INV-04: the Owner corrects or deletes a stock-in. Returns the correcting stock-in's id. */
export const correctStockIn = (receiptId: string, correction: Correction) =>
  call('correct_stock_in', correctionArgs(receiptId, correction)).then(String);

/** INV-04: Special Sales asks the Owner to correct or delete one of their own stock-ins. */
export const requestStockInCorrection = (receiptId: string, correction: Correction) =>
  call('request_stock_in_correction', correctionArgs(receiptId, correction));

/** Reorder level set, and stock at or below it (INV-05). */
export const isLowStock = (product: { stockQty: number; reorderLevel: number; active: boolean }) =>
  product.active && product.reorderLevel > 0 && product.stockQty <= product.reorderLevel;

export function describeStockError(error: unknown, productName: (id: string) => string): string {
  const { code, message, details } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  if (message === 'duplicate_product') {
    try {
      const detail = JSON.parse(String(details)) as { product_id?: string; line?: number };
      return `${productName(detail.product_id ?? '')} is already on line ${detail.line}.`;
    } catch {
      return 'A product is on more than one line.';
    }
  }
  if (message === 'product_inactive') {
    return `${productName(String(details))} is inactive and cannot be stocked in.`;
  }
  if (message === 'supplier_inactive') return 'This supplier is inactive. Choose another.';
  if (message === 'stock_negative') {
    try {
      const detail = JSON.parse(String(details)) as {
        product_id?: string;
        stock?: number;
        result?: number;
      };
      return `${productName(detail.product_id ?? '')}: only ${detail.stock} in stock; this would leave ${detail.result}.`;
    } catch {
      return 'This would take stock below zero.';
    }
  }
  if (message === 'receipt_corrected') {
    return 'This stock-in was already corrected. Correct the newer version instead.';
  }
  if (message === 'no_change') return 'Change at least one thing, or close the form.';
  if (message === 'request_pending') {
    return 'You already have a pending request for this. Withdraw it first to make a new one.';
  }
  if (message === 'invalid_input')
    return 'Some lines are not valid. Check the quantities and costs.';
  if (message === 'not_found') return 'A product or supplier no longer exists. Reload the page.';
  if (code === '42501') return 'This account cannot record stock-ins.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. Stock-in needs to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
