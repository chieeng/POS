import { formatPeso } from '@/lib/money';
import { isSoldByMeasure } from '@/lib/quantity';

/**
 * POS-03: package deals, worked out on the device as complete_sale works them out on the server
 * (the owner's decisions of Nov 1 and Nov 12, 2026):
 *   quantity: "3 for ₱100" over any mix of the chosen products;
 *   bundle: specific items at one price ("1 Coffee + 1 Creamer for ₱20");
 *   as many full sets as the cart holds; leftovers at the regular price (in a quantity deal the
 *   leftovers are the lowest-priced units); whole units only, never kg or L;
 *   the saving is split over the deal's lines in proportion to their regular prices in the
 *   sets, to the centavo, with any leftover centavo on the line with the biggest share.
 */
export type DealKind = 'quantity' | 'bundle';

export interface DealRule {
  id: string;
  name: string;
  kind: DealKind;
  /** What one set costs. */
  price: number;
  /** quantity: units in a set. bundle: null. */
  setSize: number | null;
  productIds: string[];
  /** bundle: how many of each product make a set, in the order of productIds. */
  qtys: number[];
  active: boolean;
}

export interface DealLine {
  productId: string;
  qty: number;
  price: number;
  unit: string;
}

export interface DealResult {
  sets: number;
  /** The whole saving, in centavos. */
  savingCents: number;
  /** Each line's share of it, in centavos (0 for a line that is all leftover). */
  shares: Map<string, number>;
}

const cents = (pesos: number) => Math.round(pesos * 100);

/** Whether a product can be part of this deal. */
export const inDeal = (rule: DealRule, product: { id: string; unit: string }) =>
  rule.productIds.includes(product.id) && !isSoldByMeasure(product.unit);

/** The deal over these lines (the cart lines of its products), or null when it gives nothing. */
export function dealResult(rule: DealRule, lines: DealLine[]): DealResult | null {
  if (!rule.active) return null;
  const mine = lines.filter((line) => inDeal(rule, { id: line.productId, unit: line.unit }));
  if (mine.some((line) => !Number.isInteger(line.qty))) return null;

  // What each line puts into the sets, at its regular price.
  const covered = new Map<string, number>();
  let sets: number;
  if (rule.kind === 'quantity') {
    const size = rule.setSize ?? 0;
    const units = mine.reduce((sum, line) => sum + line.qty, 0);
    sets = size >= 2 ? Math.floor(units / size) : 0;
    let left = sets * size;
    // The dearest units go into the sets; ties keep the cart's order.
    for (const line of [...mine].sort((a, b) => b.price - a.price)) {
      const take = Math.min(left, line.qty);
      covered.set(line.productId, take * cents(line.price));
      left -= take;
    }
  } else {
    sets = Math.min(
      ...rule.productIds.map((id, i) => {
        const qty = mine.filter((line) => line.productId === id).reduce((s, l) => s + l.qty, 0);
        return Math.floor(qty / (rule.qtys[i] ?? Infinity));
      }),
    );
    if (!Number.isFinite(sets)) sets = 0;
    rule.productIds.forEach((id, i) => {
      const line = mine.find((each) => each.productId === id);
      if (line) covered.set(id, sets * (rule.qtys[i] ?? 0) * cents(line.price));
    });
  }
  if (sets < 1) return null;

  const total = [...covered.values()].reduce((sum, value) => sum + value, 0);
  const saving = total - sets * cents(rule.price);
  if (saving <= 0) return null;

  const shares = new Map<string, number>();
  let given = 0;
  let biggest: string | null = null;
  for (const line of mine) {
    const part = covered.get(line.productId) ?? 0;
    const share = total > 0 ? Math.floor((saving * part) / total) : 0;
    shares.set(line.productId, share);
    given += share;
    if (biggest === null || part > (covered.get(biggest) ?? 0)) biggest = line.productId;
  }
  if (biggest !== null) shares.set(biggest, (shares.get(biggest) ?? 0) + saving - given);
  return { sets, savingCents: saving, shares };
}

/** "3 for ₱100.00", "1 Coffee + 1 Creamer for ₱20.00". */
export function dealSummary(rule: DealRule, nameOf: (id: string) => string | undefined): string {
  if (rule.kind === 'quantity') return `${rule.setSize} for ${formatPeso(rule.price)}`;
  const items = rule.productIds.map((id, i) => `${rule.qtys[i]} ${nameOf(id) ?? 'item'}`);
  return `${items.join(' + ')} for ${formatPeso(rule.price)}`;
}
