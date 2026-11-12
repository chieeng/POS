import { describe, expect, test } from 'vitest';
import { priceCart } from '@/features/sales/pricing';
import type { DiscountRule } from '@/features/discounts/rules';
import { dealResult, dealSummary, type DealLine, type DealRule } from './rules';

const CHIPS: DealRule = {
  id: 'q1',
  name: 'Chips 3 for ₱100',
  kind: 'quantity',
  price: 100,
  setSize: 3,
  productIds: ['classic', 'cheese', 'bbq'],
  qtys: [],
  active: true,
};
const COFFEE: DealRule = {
  id: 'b1',
  name: 'Coffee + creamer ₱20',
  kind: 'bundle',
  price: 20,
  setSize: null,
  productIds: ['coffee', 'creamer'],
  qtys: [1, 1],
  active: true,
};

const line = (productId: string, qty: number, price: number, unit = 'pack'): DealLine => ({
  productId,
  qty,
  price,
  unit,
});
const shares = (result: ReturnType<typeof dealResult>) =>
  Object.fromEntries([...(result?.shares ?? new Map())].map(([id, c]) => [id, c / 100]));

describe('"3 for ₱100" over a mix of products (Nov 12)', () => {
  test('2 Classic + 1 Cheese make a set: ₱135 → ₱100, ₱35 off split by price', () => {
    const result = dealResult(CHIPS, [line('classic', 2, 45), line('cheese', 1, 45)]);
    expect(result?.sets).toBe(1);
    expect(result?.savingCents).toBe(3500);
    expect(shares(result)).toEqual({ classic: 23.34, cheese: 11.66 });
  });

  test('seven packs make two sets of the six dearest; the leftover keeps its price', () => {
    const result = dealResult(CHIPS, [
      line('classic', 3, 45),
      line('cheese', 3, 45),
      line('bbq', 1, 50),
    ]);
    // ₱50 + 5 × ₱45 = ₱275 for ₱200.
    expect(result?.sets).toBe(2);
    expect(result?.savingCents).toBe(7500);
    const split = shares(result);
    expect(split.classic! + split.cheese! + split.bbq!).toBeCloseTo(75, 2);
  });

  test('not a full set, no saving, or switched off: nothing', () => {
    expect(dealResult(CHIPS, [line('classic', 2, 45)])).toBeNull();
    expect(dealResult(CHIPS, [line('classic', 3, 30)])).toBeNull();
    expect(dealResult({ ...CHIPS, active: false }, [line('classic', 3, 45)])).toBeNull();
  });

  test('products sold by weight never count (whole units only)', () => {
    const rice = { ...CHIPS, productIds: ['rice'], setSize: 2 };
    expect(dealResult(rice, [line('rice', 2, 99, 'kg')])).toBeNull();
  });
});

describe('bundles: as many full sets as the cart holds (Nov 12)', () => {
  test('2 Coffee + 3 Creamer: two bundles, one creamer left', () => {
    const result = dealResult(COFFEE, [line('coffee', 2, 14), line('creamer', 3, 8)]);
    expect(result?.sets).toBe(2);
    expect(result?.savingCents).toBe(400);
    expect(shares(result)).toEqual({ coffee: 2.55, creamer: 1.45 });
  });

  test('an item missing: no bundle', () => {
    expect(dealResult(COFFEE, [line('coffee', 2, 14)])).toBeNull();
  });
});

test('how deals read', () => {
  expect(dealSummary(CHIPS, () => undefined)).toBe('3 for ₱100.00');
  expect(dealSummary(COFFEE, (id) => ({ coffee: 'Coffee', creamer: 'Creamer' })[id])).toBe(
    '1 Coffee + 1 Creamer for ₱20.00',
  );
});

describe('the cart (POS-03: one deal or preset per line; staff apply deals)', () => {
  const byId = new Map(
    [
      { id: 'classic', unit: 'pack', sellPrice: 45, categoryId: null },
      { id: 'cheese', unit: 'pack', sellPrice: 45, categoryId: null },
      { id: 'coffee', unit: 'sachet', sellPrice: 14, categoryId: null },
    ].map((product) => [product.id, product]),
  );
  const SUKI: DiscountRule = {
    id: 'd1',
    name: 'Suki 10%',
    kind: 'percent',
    value: 10,
    appliesTo: 'all',
    categoryIds: [],
    productIds: [],
    active: true,
  };

  test('a deal the cart could take is offered, not applied', () => {
    const pricing = priceCart(
      [
        { productId: 'classic', qty: 2 },
        { productId: 'cheese', qty: 1 },
      ],
      byId,
      [],
      [CHIPS],
    );
    expect(pricing.offers).toEqual([{ rule: CHIPS, saving: 35 }]);
    expect(pricing.applied).toEqual([]);
    expect(pricing.discountCents).toBe(0);
  });

  test('applied, it prices its lines; other lines keep their preset', () => {
    const pricing = priceCart(
      [
        { productId: 'classic', qty: 2, dealId: 'q1' },
        { productId: 'cheese', qty: 1, dealId: 'q1' },
        { productId: 'coffee', qty: 1, discountId: 'd1' },
      ],
      byId,
      [SUKI],
      [CHIPS],
    );
    expect(pricing.applied).toEqual([{ rule: CHIPS, sets: 1, saving: 35 }]);
    expect(pricing.offers).toEqual([]);
    expect(pricing.perLine.get('classic')).toEqual({
      kind: 'deal',
      id: 'q1',
      name: 'Chips 3 for ₱100',
      amount: 23.34,
    });
    expect(pricing.perLine.get('coffee')).toMatchObject({ kind: 'preset', amount: 1.4 });
    // ₱90 + ₱45 + ₱14 = ₱149; ₱35 + ₱1.40 off.
    expect(pricing.subtotalCents).toBe(14900);
    expect(pricing.discountCents).toBe(3640);
  });

  test('an applied deal that is no longer a full set gives nothing', () => {
    const pricing = priceCart([{ productId: 'classic', qty: 2, dealId: 'q1' }], byId, [], [CHIPS]);
    expect(pricing.applied).toEqual([]);
    expect(pricing.perLine.size).toBe(0);
  });
});
