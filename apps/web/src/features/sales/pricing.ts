import { dealResult, inDeal, type DealRule } from '@/features/deals/rules';
import { lineDiscount, type DiscountRule } from '@/features/discounts/rules';
import type { CartLine } from './cart';
import { lineTotalCents } from './totals';

/**
 * POS-03: what each cart line pays, from the presets and deals staff picked. One deal or one
 * preset per line; a deal that no longer makes a full set, or a preset that no longer fits,
 * simply gives nothing (and is not sent to the server).
 */
export interface LinePrice {
  kind: 'preset' | 'deal';
  id: string;
  name: string;
  /** Pesos off this line; 0 for a deal line that is all leftover. */
  amount: number;
}

export interface AppliedDeal {
  rule: DealRule;
  sets: number;
  saving: number;
}

export interface Pricing {
  perLine: Map<string, LinePrice>;
  applied: AppliedDeal[];
  /** Deals the cart could take now and doesn't yet, with what each would save. */
  offers: { rule: DealRule; saving: number }[];
  subtotalCents: number;
  discountCents: number;
}

type Priced = { id: string; unit: string; sellPrice: number; categoryId: string | null };

export function priceCart(
  lines: CartLine[],
  byId: Map<string, Priced>,
  presets: DiscountRule[],
  deals: DealRule[],
): Pricing {
  const perLine = new Map<string, LinePrice>();
  const applied: AppliedDeal[] = [];
  const dealLines = (rule: DealRule, pick: (line: CartLine) => boolean) =>
    lines.flatMap((line) => {
      const product = byId.get(line.productId);
      return product && pick(line) && inDeal(rule, product)
        ? [
            {
              productId: line.productId,
              qty: line.qty,
              price: product.sellPrice,
              unit: product.unit,
            },
          ]
        : [];
    });

  // Deals staff applied.
  for (const rule of deals) {
    const result = dealResult(
      rule,
      dealLines(rule, (line) => line.dealId === rule.id),
    );
    if (!result) continue;
    applied.push({ rule, sets: result.sets, saving: result.savingCents / 100 });
    for (const [productId, share] of result.shares) {
      perLine.set(productId, { kind: 'deal', id: rule.id, name: rule.name, amount: share / 100 });
    }
  }

  // Presets, on lines not in a working deal.
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product || perLine.has(line.productId)) continue;
    const discount = lineDiscount(presets, line, product);
    if (discount) perLine.set(line.productId, { kind: 'preset', ...discount });
  }

  // What else could apply: deals over lines not already in a working deal.
  const offers = deals.flatMap((rule) => {
    if (applied.some((each) => each.rule.id === rule.id)) return [];
    const result = dealResult(
      rule,
      dealLines(rule, (line) => perLine.get(line.productId)?.kind !== 'deal'),
    );
    return result ? [{ rule, saving: result.savingCents / 100 }] : [];
  });

  let subtotalCents = 0;
  let discountCents = 0;
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) continue;
    subtotalCents += lineTotalCents(line.qty, product.sellPrice);
    discountCents += Math.round((perLine.get(line.productId)?.amount ?? 0) * 100);
  }
  return { perLine, applied, offers, subtotalCents, discountCents };
}
