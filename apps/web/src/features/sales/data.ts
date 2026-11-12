import { getDeviceTag } from '@/lib/device';
import { registerSender, sendFailure, type OutboxItem, type SendResult } from '@/lib/outbox';
import { supabase } from '@/lib/supabase';

/**
 * A sale as complete_sale takes it (SRS 5.2). The device makes the id and the receipt number,
 * so sending it twice is safe (POS-06), and keeps the prices and settings it used: the
 * customer paid them, and the server only flags what changed since (POS-14).
 */
export interface SalePayload {
  id: string;
  receipt_no: string;
  /** When it was made, by this device's clock (ISO). */
  made_at: string;
  /** Made, or first sent, without a connection: a reused reference is flagged, not refused. */
  offline: boolean;
  round_cash: boolean;
  /** null when the store was not VAT registered on this device. */
  vat_rate: number | null;
  /** What the device showed the customer; the server refuses a sale that adds up otherwise. */
  total: number;
  /** discount_id and discount: the preset picked and what this device took off (POS-03). */
  lines: {
    product_id: string;
    qty: number;
    unit_price: number;
    discount_id?: string;
    discount?: number;
  }[];
  payments: (
    | { method: 'cash'; amount: number }
    | { method: 'gcash' | 'maya'; amount: number; reference: string; account_id?: string | null }
  )[];
}

export type SaleFlag =
  | 'price_changed'
  | 'settings_changed'
  | 'product_inactive'
  | 'discount_changed'
  | 'stock_negative'
  | 'duplicate_reference'
  | 'late'
  | 'clock_ahead';

/** What the server says about a recorded sale, the first time and on every resend. */
export interface SaleResult {
  id: string;
  receiptNo: string;
  subtotal: number;
  rounding: number;
  total: number;
  change: number;
  vatRate: number | null;
  vatAmount: number | null;
  flags: SaleFlag[];
  /** In a drawer already, or waiting for the next one to open (POS-14). */
  attached: boolean;
}

const toResult = (row: Record<string, unknown>): SaleResult => ({
  id: String(row.id ?? ''),
  receiptNo: String(row.receiptNo ?? ''),
  subtotal: Number(row.subtotal ?? 0),
  rounding: Number(row.rounding ?? 0),
  total: Number(row.total ?? 0),
  change: Number(row.change ?? 0),
  vatRate: row.vatRate === null || row.vatRate === undefined ? null : Number(row.vatRate),
  vatAmount: row.vatAmount === null || row.vatAmount === undefined ? null : Number(row.vatAmount),
  flags: Array.isArray(row.flags) ? (row.flags as SaleFlag[]) : [],
  attached: row.attached === true,
});

/** POS-06: records the sale on the server, or returns it as first recorded. */
export async function completeSale(payload: SalePayload): Promise<SaleResult> {
  const { data, error } = await supabase.rpc('complete_sale', {
    p_sale: payload,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
  return toResult((data ?? {}) as Record<string, unknown>);
}

/**
 * Sends a sale from the outbox. Anything in the outbox was not confirmed while the customer
 * was there, so it goes as offline: a reused reference is then flagged for the Owner rather
 * than refused, because nobody can ask the customer again (POS-13).
 */
export async function sendSale(item: OutboxItem): Promise<SendResult> {
  try {
    await completeSale({ ...(item.payload as unknown as SalePayload), offline: true });
    return { sent: true };
  } catch (error) {
    return sendFailure(error);
  }
}

/** Lets the outbox send sales; called once when the app starts (see outboxSync). */
export const registerSaleSender = () => registerSender('sale', sendSale);

// ---- Receipt numbers (POS-08) ----------------------------------------------------------------
const SEQUENCE_KEY = 'pos.receiptSequence';

/** "20261106": the store's day (Asia/Manila) of a moment. */
export const manilaDay = (when: Date) =>
  when.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).replaceAll('-', '');

/**
 * The next number in this device's sequence for a day: 1, 2, 3… starting again each day.
 * Kept next to the device tag, so clearing the browser's data gives a new tag as well and two
 * receipts never share a number.
 */
export function nextReceiptSequence(day: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(SEQUENCE_KEY) ?? 'null') as {
      day?: unknown;
      last?: unknown;
    } | null;
    const last = saved?.day === day && typeof saved.last === 'number' ? saved.last : 0;
    const next = last + 1;
    localStorage.setItem(SEQUENCE_KEY, JSON.stringify({ day, last: next }));
    return next;
  } catch {
    // Storage blocked: the time of day keeps numbers apart within this page load.
    return Math.floor((Date.now() % 86_400_000) / 1000) + 1;
  }
}

/** POS-08: `<user code>-<YYYYMMDD>-<device tag>-<sequence>`, for example "JR-20261106-K7Q2-14". */
export function receiptNumber(userCode: string, when: Date, deviceTag = getDeviceTag()): string {
  const day = manilaDay(when);
  return `${userCode}-${day}-${deviceTag}-${nextReceiptSequence(day)}`;
}

/** The server's refusals as a sentence for the person at the counter. */
export function describeSaleError(error: unknown): string {
  const { code, message, details } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  if (message === 'duplicate_reference') {
    const reference = typeof details === 'string' && details ? `${details} ` : '';
    return `Reference ${reference}is already on another sale. Check the number on the customer's phone.`;
  }
  if (message === 'cash_short') return 'The cash given is less than what is due.';
  if (message === 'receipt_taken') return 'This receipt number is already used. Try again.';
  if (message === 'not_found') return 'A product or account in this sale no longer exists.';
  if (message === 'invalid_input') return 'This sale does not add up. Check the cart and payment.';
  if (code === '42501') return 'This account cannot record sales.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. The sale is kept on this device and sent later.';
  }
  return 'Something went wrong. Try again.';
}
