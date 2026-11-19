import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';
import type { SaleDetail } from './history';

/** What a void gives back (POS-10): cash out of today's drawer, GCash/Maya sent by the Owner. */
export function voidAmounts(sale: Pick<SaleDetail, 'payments'>): { cash: number; ewallet: number } {
  let cash = 0;
  let ewallet = 0;
  for (const payment of sale.payments) {
    if (payment.method === 'cash') cash += payment.amount;
    else ewallet += payment.amount;
  }
  return { cash: Math.round(cash * 100) / 100, ewallet: Math.round(ewallet * 100) / 100 };
}

/** Special Sales and Sales: ask the Owner to void one of their own sales, with a reason. */
export async function requestSaleVoid(saleId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('request_sale_void', {
    p_sale_id: saleId,
    p_reason: reason.trim(),
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

/** The Owner voids directly, with a reason, and the GCash/Maya refund's reference if any. */
export async function voidSale(
  saleId: string,
  reason: string,
  refundReference: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('void_sale', {
    p_sale_id: saleId,
    p_reason: reason.trim(),
    p_refund_reference: refundReference?.trim() || null,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

/** Why a void can't be asked for now, in the staff's words. */
export const VOID_BLOCKED: Record<string, string> = {
  drawer_waiting:
    'This sale is waiting for today’s drawer. Once the drawer is open, it can be voided.',
  drawer_closed: 'Its drawer was closed, so it can no longer be voided. Return the items instead.',
  sale_not_completed: 'This sale was already voided or corrected.',
  sale_has_returns:
    'Part of this sale was returned, so it can’t be voided. Return the rest instead.',
};

export function describeVoidError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (typeof message === 'string' && message in VOID_BLOCKED) return VOID_BLOCKED[message]!;
  switch (message) {
    case 'request_pending':
      return 'You already asked to void this sale. Withdraw that request in My requests first.';
    case 'refund_reference_required':
      return 'Type the reference of the GCash or Maya refund you sent.';
    case 'invalid_input':
      return 'Check the reason (up to 200 characters) and the reference (4 to 40 letters or digits).';
    case 'not_found':
      return 'This sale isn’t in your history any more. Reload the page.';
  }
  if (code === '42501') return 'This account cannot do that.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. This needs to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
