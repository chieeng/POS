import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';
import type { PayMethod, SaleDetail } from './history';
import { roundToPesoCents } from './totals';

export type ReturnCondition = 'stock' | 'damaged';

/** One line picked for a return: how many units, and where they go. */
export interface ReturnPick {
  lineNo: number;
  qty: number;
  condition: ReturnCondition;
}

const cents = (pesos: number) => Math.round(pesos * 100);

/** Units of a line still returnable. */
export const leftOf = (line: SaleDetail['lines'][number]) =>
  Math.round((line.qty - line.returnedQty) * 1000) / 1000;

/**
 * POS-10: what a return gives back, worked out the same way as the server (plan_return): each
 * unit's share of what the line was paid after its discount or deal; the last units of a line
 * get exactly what is left of it. Cash is rounded to the peso when the store rounds cash.
 */
export function planRefund(
  sale: Pick<SaleDetail, 'lines' | 'roundCash'>,
  picks: readonly ReturnPick[],
  method: PayMethod,
): { refund: number; handed: number; lines: { lineNo: number; refund: number }[] } {
  let total = 0;
  const lines = picks.flatMap((pick) => {
    const line = sale.lines.find((l) => l.lineNo === pick.lineNo);
    if (!line || pick.qty <= 0) return [];
    const refund =
      pick.qty >= leftOf(line)
        ? cents(line.lineTotal) - cents(line.refunded)
        : Math.round((cents(line.lineTotal) * pick.qty) / line.qty);
    total += refund;
    return [{ lineNo: line.lineNo, refund: refund / 100 }];
  });
  const handed = method === 'cash' && sale.roundCash ? roundToPesoCents(total) : total;
  return { refund: total / 100, handed: handed / 100, lines };
}

/** What can still be given back by each method the sale was paid with. */
export function refundableBy(sale: Pick<SaleDetail, 'payments' | 'refunded'>) {
  const paid = new Map<PayMethod, number>();
  for (const payment of sale.payments) {
    paid.set(payment.method, (paid.get(payment.method) ?? 0) + cents(payment.amount));
  }
  return [...paid].map(([method, amount]) => ({
    method,
    left: Math.max(0, amount - cents(sale.refunded[method] ?? 0)) / 100,
  }));
}

/** Special Sales and Sales: ask the Owner to take items back, with a reason. */
export async function requestSaleReturn(
  saleId: string,
  picks: readonly ReturnPick[],
  method: PayMethod,
  reason: string,
  defective: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('request_sale_return', {
    p_sale_id: saleId,
    p_items: picks,
    p_refund_method: method,
    p_reason: reason.trim(),
    p_defective: defective,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

/** The Owner takes items back directly, with the GCash/Maya refund's reference if any. */
export async function returnSale(
  saleId: string,
  picks: readonly ReturnPick[],
  method: PayMethod,
  reason: string,
  defective: boolean,
  refundReference: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('return_sale', {
    p_sale_id: saleId,
    p_items: picks,
    p_refund_method: method,
    p_reason: reason.trim(),
    p_defective: defective,
    p_refund_reference: refundReference?.trim() || null,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

export function describeReturnError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  switch (message) {
    case 'return_qty':
      return 'That is more than is left to return on this sale. Reload the page.';
    case 'refund_method_invalid':
      return 'Refund the way the customer paid.';
    case 'refund_too_large':
      return 'That is more than was paid this way. Pick the other way the customer paid, or return fewer items.';
    case 'return_window_passed':
      return 'This sale is past the return window. Only a defective item can be returned now.';
    case 'drawer_not_open':
      return 'A cash refund comes out of today’s drawer. Open today’s drawer first.';
    case 'refund_reference_required':
      return 'Type the reference of the GCash or Maya refund you sent.';
    case 'request_pending':
      return 'You already asked for a return on this sale. Wait for the Owner, or withdraw it in My requests.';
    case 'sale_not_completed':
      return 'This sale was voided or corrected, so it can’t be returned.';
    case 'invalid_input':
      return 'Check the quantities (whole units, or up to 3 decimals for kg and L), the reason and the reference.';
    case 'not_found':
      return 'This sale isn’t in your history any more. Reload the page.';
  }
  if (code === '42501') return 'This account cannot do that.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. This needs to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
