import type { Product } from '@/features/catalog/data';
import type { DealRule } from '@/features/deals/rules';
import type { DiscountRule } from '@/features/discounts/rules';
import type { BranchSettings, PaymentAccount, PaymentProvider } from '@/features/store/data';
import { addToOutbox, sendFailure } from '@/lib/outbox';
import { vatPart } from '@/lib/money';
import { completeSale, receiptNumber, type SalePayload } from './data';
import { lineTotalCents, saleTotals, type SalePaymentInput } from './totals';

/**
 * Checkout on the device (POS-04, POS-06, POS-07, POS-13, POS-14): builds the sale from the
 * cart and the payments, sends it while online, and keeps it in the outbox otherwise. The
 * slip is drawn from what the device knows, so it shows the same either way.
 */

// ---- What the device remembers about the store, for offline sales ---------------------------
const STORE_KEY = 'pos.checkoutSettings';

/** The store settings a sale and its slip need. */
export interface CheckoutSettings {
  name: string;
  address: string | null;
  contact: string | null;
  tin: string | null;
  receiptFooter: string | null;
  roundCash: boolean;
  /** null when not VAT registered. */
  vatRate: number | null;
  accounts: Pick<PaymentAccount, 'id' | 'provider' | 'label' | 'number'>[];
  /** POS-03: the presets switched on, so staff can pick them offline too. */
  discounts: DiscountRule[];
  /** POS-03: the package deals switched on, likewise. */
  deals: DealRule[];
}

/**
 * Safe defaults for a device that has never been online: round cash, no VAT, no accounts and
 * no discounts or deals.
 */
export const DEFAULT_SETTINGS: CheckoutSettings = {
  name: 'Store',
  address: null,
  contact: null,
  tin: null,
  receiptFooter: null,
  roundCash: true,
  vatRate: null,
  accounts: [],
  discounts: [],
  deals: [],
};

export function settingsFrom(
  branch: BranchSettings,
  accounts: PaymentAccount[],
  discounts: DiscountRule[] = [],
  deals: DealRule[] = [],
): CheckoutSettings {
  return {
    name: branch.name,
    address: branch.address,
    contact: branch.contact,
    tin: branch.tin,
    receiptFooter: branch.receiptFooter,
    roundCash: branch.roundCash,
    vatRate: branch.vatRegistered ? branch.vatRate : null,
    accounts: accounts
      .filter((account) => account.active)
      .map(({ id, provider, label, number }) => ({ id, provider, label, number })),
    discounts: discounts.filter((rule) => rule.active),
    deals: deals.filter((rule) => rule.active),
  };
}

/** Kept on the device each time the settings load, for selling without a connection. */
export function rememberSettings(settings: CheckoutSettings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: offline sales fall back to the defaults.
  }
}

export function rememberedSettings(): CheckoutSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as CheckoutSettings | null;
    return saved && typeof saved.roundCash === 'boolean'
      ? {
          ...DEFAULT_SETTINGS,
          ...saved,
          discounts: Array.isArray(saved.discounts) ? saved.discounts : [],
          deals: Array.isArray(saved.deals) ? saved.deals : [],
        }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ---- References already used on this device (POS-13) ---------------------------------------
const REFS_KEY = 'pos.usedReferences';
const REFS_KEPT = 1000;

/** "1012 345 678" and "1012345678" are the same reference, as the server keeps it. */
export const normalizeReference = (reference: string) => reference.replace(/\s/g, '').toUpperCase();

export const REFERENCE = /^[A-Z0-9-]{4,40}$/;

interface UsedReference {
  method: PaymentProvider;
  reference: string;
  receiptNo: string;
}

function usedReferences(): UsedReference[] {
  try {
    const saved = JSON.parse(localStorage.getItem(REFS_KEY) ?? '[]') as UsedReference[];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/** The receipt on this device that already used this reference, if any. */
export function referenceUsedOnDevice(method: PaymentProvider, reference: string): string | null {
  const ref = normalizeReference(reference);
  return (
    usedReferences().find((used) => used.method === method && used.reference === ref)?.receiptNo ??
    null
  );
}

function rememberReferences(receiptNo: string, payments: PaymentEntry[]): void {
  const added = payments.flatMap((payment) =>
    payment.method === 'cash'
      ? []
      : [{ method: payment.method, reference: normalizeReference(payment.reference), receiptNo }],
  );
  if (added.length === 0) return;
  try {
    localStorage.setItem(
      REFS_KEY,
      JSON.stringify([...added, ...usedReferences()].slice(0, REFS_KEPT)),
    );
  } catch {
    // Storage blocked: the server still checks while online.
  }
}

// ---- The sale ----------------------------------------------------------------------------------
export type PaymentEntry =
  | { method: 'cash'; amount: number }
  | { method: PaymentProvider; amount: number; reference: string; accountId: string | null };

export interface SoldLine {
  product: Pick<Product, 'id' | 'name' | 'unit' | 'sellPrice'>;
  qty: number;
  /** POS-03: the preset picked for the line and what it takes off, in pesos. */
  discount?: { kind: 'preset' | 'deal'; id: string; name: string; amount: number };
}

/** The lines as the totals take them. */
export const totalsLines = (lines: SoldLine[]) =>
  lines.map((line) => ({
    qty: line.qty,
    unitPrice: line.product.sellPrice,
    discount: line.discount?.amount ?? 0,
  }));

/** Everything the slip shows (POS-07). */
export interface Slip {
  id: string;
  receiptNo: string;
  madeAt: Date;
  store: Pick<CheckoutSettings, 'name' | 'address' | 'contact' | 'tin' | 'receiptFooter'>;
  salesperson: string;
  lines: {
    name: string;
    qty: number;
    unit: string;
    unitPrice: number;
    /** After its discount. */
    total: number;
    discount?: { name: string; amount: number };
  }[];
  /** Before discounts. */
  subtotal: number;
  discountTotal: number;
  rounding: number;
  total: number;
  vatRate: number | null;
  vatAmount: number | null;
  payments: {
    method: 'cash' | PaymentProvider;
    amount: number;
    reference?: string;
    accountLabel?: string;
  }[];
  /** Cash handed over, and the change given back. */
  tendered: number | null;
  change: number;
  /** sent: the server has it. waiting: kept on this device until it can be sent. */
  status: 'sent' | 'waiting';
}

export class CheckoutError extends Error {
  constructor(
    readonly reason: 'no_user_code' | 'storage' | 'server',
    readonly detail?: unknown,
  ) {
    super(reason);
  }
}

/**
 * Records the sale: online it goes straight to the server, so a refusal (a reused reference)
 * can be fixed with the customer still there; without a connection, or if the connection drops
 * on the way, it waits in the outbox and syncs later (NFR-02).
 */
export async function checkout(input: {
  uid: string;
  branchId: string;
  userCode: string | undefined;
  salesperson: string;
  settings: CheckoutSettings;
  lines: SoldLine[];
  payments: PaymentEntry[];
  online: boolean;
  now?: Date;
}): Promise<Slip> {
  if (!input.userCode) throw new CheckoutError('no_user_code');
  const now = input.now ?? new Date();
  const { settings } = input;
  const totals = saleTotals(
    totalsLines(input.lines),
    input.payments as SalePaymentInput[],
    settings.roundCash,
  );
  const cash = input.payments.find((payment) => payment.method === 'cash');
  const payload: SalePayload = {
    id: crypto.randomUUID(),
    receipt_no: receiptNumber(input.userCode, now),
    made_at: now.toISOString(),
    offline: !input.online,
    round_cash: settings.roundCash,
    vat_rate: settings.vatRate,
    total: totals.total,
    lines: input.lines.map((line) => ({
      product_id: line.product.id,
      qty: line.qty,
      unit_price: line.product.sellPrice,
      ...(line.discount?.kind === 'preset'
        ? { discount_id: line.discount.id, discount: line.discount.amount }
        : line.discount?.kind === 'deal'
          ? { deal_id: line.discount.id, discount: line.discount.amount }
          : {}),
    })),
    payments: input.payments.map((payment) =>
      payment.method === 'cash'
        ? { method: 'cash', amount: payment.amount }
        : {
            method: payment.method,
            amount: payment.amount,
            reference: normalizeReference(payment.reference),
            account_id: payment.accountId,
          },
    ),
  };

  const accountLabel = (id: string | null) =>
    settings.accounts.find((account) => account.id === id)?.label;
  const slip: Slip = {
    id: payload.id,
    receiptNo: payload.receipt_no,
    madeAt: now,
    store: {
      name: settings.name,
      address: settings.address,
      contact: settings.contact,
      tin: settings.tin,
      receiptFooter: settings.receiptFooter,
    },
    salesperson: input.salesperson,
    lines: input.lines.map((line) => {
      const gross = lineTotalCents(line.qty, line.product.sellPrice);
      const off = Math.round((line.discount?.amount ?? 0) * 100);
      return {
        name: line.product.name,
        qty: line.qty,
        unit: line.product.unit,
        unitPrice: line.product.sellPrice,
        total: (gross - off) / 100,
        ...(line.discount && line.discount.amount > 0
          ? { discount: { name: line.discount.name, amount: line.discount.amount } }
          : {}),
      };
    }),
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    rounding: totals.rounding,
    total: totals.total,
    vatRate: settings.vatRate,
    // POS-07: the VAT part of what the customer pays for the goods, after discounts.
    vatAmount:
      settings.vatRate === null
        ? null
        : vatPart(totals.subtotal - totals.discountTotal, settings.vatRate),
    payments: input.payments.map((payment) =>
      payment.method === 'cash'
        ? { method: 'cash', amount: totals.cashDue }
        : {
            method: payment.method,
            amount: payment.amount,
            reference: normalizeReference(payment.reference),
            accountLabel: accountLabel(payment.accountId),
          },
    ),
    tendered: cash ? cash.amount : null,
    change: totals.change,
    status: 'sent',
  };

  const keep = async () => {
    try {
      await addToOutbox({
        id: payload.id,
        kind: 'sale',
        uid: input.uid,
        branchId: input.branchId,
        payload: { ...payload, offline: true } as unknown as Record<string, unknown>,
      });
    } catch (error) {
      throw new CheckoutError('storage', error);
    }
    rememberReferences(slip.receiptNo, input.payments);
    return { ...slip, status: 'waiting' as const };
  };

  if (!input.online) return keep();
  try {
    await completeSale(payload);
  } catch (error) {
    // The connection dropped or the server is busy: the sale may or may not have reached it.
    // Its id makes sending it again from the outbox safe either way (POS-06).
    if ('retry' in sendFailure(error)) return keep();
    throw new CheckoutError('server', error);
  }
  rememberReferences(slip.receiptNo, input.payments);
  return slip;
}
