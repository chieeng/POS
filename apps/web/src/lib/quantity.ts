/**
 * PROD-01: quantities. Products in kg or L are sold by weight or volume and take up to 3
 * decimals; every other unit stays whole. The server checks the same rules again
 * (private.require_qty and the tables' constraints); these are for feedback while typing.
 */

/** The units sold by weight or volume. */
export const MEASURE_UNITS = ['kg', 'L'] as const;

export const isSoldByMeasure = (unit: string) =>
  (MEASURE_UNITS as readonly string[]).includes(unit);

/** The largest quantity one line can hold (stock-in, adjustment, correction). */
export const MAX_QTY = 100_000;

const WHOLE = /^\d{1,7}$/;
const MEASURE = /^(\d{1,7}(\.\d{0,3})?|\.\d{1,3})$/;

/**
 * A typed quantity as a number, or null if it is not one this unit can hold: digits only,
 * and at most 3 decimals for kg and L. Range checks are left to the caller.
 */
export function parseQty(text: string, unit: string): number | null {
  const typed = text.trim();
  if (!(isSoldByMeasure(unit) ? MEASURE : WHOLE).test(typed)) return null;
  return Number(typed);
}

/** The smallest quantity a line can have: 1, or 0.001 for kg and L. */
export const minQty = (unit: string) => (isSoldByMeasure(unit) ? 0.001 : 1);

/**
 * "Enter a whole quantity of at least 1." or "Enter a quantity in kg, up to 3 decimals, for
 * example 1.25."
 */
export function qtyRule(unit: string, { zeroAllowed = false } = {}): string {
  if (isSoldByMeasure(unit)) {
    return `enter a quantity in ${unit}, up to 3 decimals, for example 1.25${zeroAllowed ? ' (0 takes it off)' : ''}.`;
  }
  return zeroAllowed
    ? 'enter a whole quantity (0 takes it off).'
    : 'enter a whole quantity of at least 1.';
}

/** The keyboard a phone shows for this unit's quantities. */
export const qtyInputMode = (unit: string) => (isSoldByMeasure(unit) ? 'decimal' : 'numeric');

/**
 * A quantity as the store writes it: "12", "1.25", "0.5". Up to 3 decimals, no trailing
 * zeros, no thousands separators (so a CSV keeps it a number).
 */
export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

/** "1.25 kg", "12 pc". */
export const qtyWithUnit = (value: number, unit: string) => `${formatQty(value)} ${unit}`;

/** "+2.5", "−3": a stock change with its sign (a true minus sign, as the app writes it). */
export const signedQty = (value: number) => `${value > 0 ? '+' : '−'}${formatQty(Math.abs(value))}`;
