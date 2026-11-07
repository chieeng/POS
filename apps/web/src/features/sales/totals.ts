/**
 * A sale's totals, worked out on the device exactly as complete_sale works them out on the
 * server (POS-04, POS-07), in whole centavos so no rounding creeps in:
 *   line total = qty × unit price, to the centavo (half up);
 *   GCash and Maya are exact; the cash part is the rest, rounded to the peso when the store
 *   rounds cash (exactly ₱0.50 up, the owner's decision of Nov 4, 2026);
 *   total = subtotal − discounts + rounding; change = cash tendered − cash due.
 */
export interface SaleLineInput {
  qty: number;
  unitPrice: number;
  /** Later step 9 PRs fill this from preset discounts and package deals. */
  discount?: number;
}

export interface SalePaymentInput {
  method: 'cash' | 'gcash' | 'maya';
  /** Cash: what the customer handed over. GCash and Maya: the exact amount sent. */
  amount: number;
}

export interface SaleTotals {
  subtotal: number;
  discountTotal: number;
  /** What GCash and Maya cover. */
  nonCash: number;
  /** What is left for cash before rounding, and what cash is due after it. */
  cashPart: number;
  cashDue: number;
  /** cashDue − cashPart: +0.25, −0.48, or 0. */
  rounding: number;
  total: number;
  /** Cash tendered − cash due; 0 with no cash. */
  change: number;
  /** null when the payments cannot complete the sale yet, else why not. */
  problem: null | 'more_than_total' | 'cash_needed' | 'cash_short' | 'cash_not_needed';
}

const cents = (pesos: number) => Math.round(pesos * 100);
const pesos = (value: number | bigint) => Number(value) / 100;

/** qty × price to the centavo, half up, without floating-point error. */
export function lineTotalCents(qty: number, unitPrice: number): number {
  const milli = BigInt(Math.round(qty * 1000));
  const price = BigInt(cents(unitPrice));
  return Number((milli * price + 500n) / 1000n);
}

/** A cash amount rounded to the peso, exactly ₱0.50 up. */
export const roundToPesoCents = (value: number) => Math.floor((value + 50) / 100) * 100;

export function saleTotals(
  lines: SaleLineInput[],
  payments: SalePaymentInput[],
  roundCash: boolean,
): SaleTotals {
  const gross = lines.reduce((sum, line) => sum + lineTotalCents(line.qty, line.unitPrice), 0);
  const discount = lines.reduce((sum, line) => sum + cents(line.discount ?? 0), 0);
  const subtotal = gross;
  const goods = subtotal - discount;
  const nonCash = payments
    .filter((payment) => payment.method !== 'cash')
    .reduce((sum, payment) => sum + cents(payment.amount), 0);
  const cash = payments.find((payment) => payment.method === 'cash');
  const tendered = cash ? cents(cash.amount) : null;

  const cashPart = Math.max(goods - nonCash, 0);
  const cashDue = roundCash ? roundToPesoCents(cashPart) : cashPart;
  const rounding = cashDue - cashPart;

  let problem: SaleTotals['problem'] = null;
  if (nonCash > goods) problem = 'more_than_total';
  else if (cashDue > 0 && tendered === null) problem = 'cash_needed';
  else if (cashDue > 0 && tendered !== null && tendered < cashDue) problem = 'cash_short';
  else if (cashDue === 0 && tendered !== null) problem = 'cash_not_needed';

  return {
    subtotal: pesos(subtotal),
    discountTotal: pesos(discount),
    nonCash: pesos(nonCash),
    cashPart: pesos(cashPart),
    cashDue: pesos(cashDue),
    rounding: pesos(rounding),
    total: pesos(goods + rounding),
    change: tendered !== null && cashDue > 0 ? pesos(Math.max(tendered - cashDue, 0)) : 0,
    problem,
  };
}

/** Exact, then the next round amounts a customer might hand over: ₱320, ₱350, ₱400, ₱500, ₱1,000. */
export function quickCash(due: number): number[] {
  if (due <= 0) return [];
  const steps = [20, 50, 100, 500, 1000].map((step) => Math.ceil(due / step) * step);
  return [due, ...[...new Set(steps)].filter((amount) => amount > due)].slice(0, 6);
}
