import { formatPeso } from '@/lib/money';
import { isSoldByMeasure } from '@/lib/quantity';
import { lineTotalCents } from '@/features/sales/totals';

/**
 * POS-03: the Owner's preset discounts, worked out on the device exactly as complete_sale
 * works them out on the server (the owner's decisions of Nov 1 and Nov 12, 2026):
 *   percent: the line total × percent, to the centavo, half up;
 *   fixed: pesos off each unit (each kg or L), not offered on a product priced at or below it;
 *   every product, chosen categories or chosen products; one preset per line, picked by staff.
 */
export type DiscountKind = 'percent' | 'fixed';
export type DiscountTarget = 'all' | 'categories' | 'products';

export interface DiscountRule {
  id: string;
  name: string;
  kind: DiscountKind;
  /** percent: 0.01–100. fixed: pesos off each unit. */
  value: number;
  appliesTo: DiscountTarget;
  categoryIds: string[];
  productIds: string[];
  active: boolean;
}

type Sellable = { id: string; categoryId: string | null; sellPrice: number };

/** Whether this preset may be picked for this product now. */
export function covers(rule: DiscountRule, product: Sellable): boolean {
  if (!rule.active) return false;
  if (rule.appliesTo === 'categories' && !rule.categoryIds.includes(product.categoryId ?? ''))
    return false;
  if (rule.appliesTo === 'products' && !rule.productIds.includes(product.id)) return false;
  return rule.kind === 'percent' || rule.value < product.sellPrice;
}

/** The presets staff may pick for this product, by name. */
export const rulesFor = (rules: DiscountRule[], product: Sellable) =>
  rules
    .filter((rule) => covers(rule, product))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

/** What the preset takes off qty × unitPrice, in centavos. */
export function discountCents(rule: DiscountRule, qty: number, unitPrice: number): number {
  if (rule.kind === 'fixed') return lineTotalCents(qty, rule.value);
  const gross = BigInt(lineTotalCents(qty, unitPrice));
  const hundredths = BigInt(Math.round(rule.value * 100));
  return Number((gross * hundredths + 5000n) / 10000n);
}

/**
 * The discount a cart line gets: its picked preset, if that still applies to the product (a
 * preset switched off meanwhile simply drops off). Pesos.
 */
export function lineDiscount(
  rules: DiscountRule[],
  line: { discountId?: string; qty: number },
  product: Sellable,
): { id: string; name: string; amount: number } | undefined {
  const rule = line.discountId ? rules.find((each) => each.id === line.discountId) : undefined;
  if (!rule || !covers(rule, product)) return undefined;
  const cents = discountCents(rule, line.qty, product.sellPrice);
  return cents > 0 ? { id: rule.id, name: rule.name, amount: cents / 100 } : undefined;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Every product", "2 categories", "5 products". */
export function targetText(rule: Pick<DiscountRule, 'appliesTo' | 'categoryIds' | 'productIds'>) {
  if (rule.appliesTo === 'categories')
    return plural(rule.categoryIds.length, 'category', 'categories');
  if (rule.appliesTo === 'products') return plural(rule.productIds.length, 'product', 'products');
  return 'Every product';
}

const percent = (value: number) => `${Number(value.toFixed(2))}%`;

/** "10% off", "₱5.00 off each", "₱10.00 off per kg". */
export function ruleAmount(rule: Pick<DiscountRule, 'kind' | 'value'>, unit?: string): string {
  if (rule.kind === 'percent') return `${percent(rule.value)} off`;
  if (unit && isSoldByMeasure(unit)) return `${formatPeso(rule.value)} off per ${unit}`;
  return `${formatPeso(rule.value)} off each`;
}
