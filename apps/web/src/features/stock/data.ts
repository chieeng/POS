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
  'id, supplier_id, reference, received_by_name, created_at, stock_receipt_items(line_no, product_id, qty, unit_cost)';

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

export function useStockReceipt(id: string) {
  return useLiveRows({
    table: 'stock_receipts',
    queryKey: `one:${id}`,
    load: () => supabase.from('stock_receipts').select(RECEIPT_COLUMNS).eq('id', id).limit(1),
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
  if (message === 'invalid_input')
    return 'Some lines are not valid. Check the quantities and costs.';
  if (message === 'not_found') return 'A product or supplier no longer exists. Reload the page.';
  if (code === '42501') return 'This account cannot record stock-ins.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. Stock-in needs to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
