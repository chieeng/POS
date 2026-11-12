import { describe, expect, test } from 'vitest';
import {
  covers,
  discountCents,
  lineDiscount,
  ruleAmount,
  rulesFor,
  targetText,
  type DiscountRule,
} from './rules';

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
const FIVE_OFF: DiscountRule = {
  ...SUKI,
  id: 'd2',
  name: '₱5 off chips',
  kind: 'fixed',
  value: 5,
  appliesTo: 'products',
  productIds: ['chips', 'candy'],
};
const GRAINS: DiscountRule = {
  ...SUKI,
  id: 'd3',
  name: 'Grains ₱10/kg',
  kind: 'fixed',
  value: 10,
  appliesTo: 'categories',
  categoryIds: ['grains'],
};

const CHIPS = { id: 'chips', categoryId: 'snacks', sellPrice: 45 };
const CANDY = { id: 'candy', categoryId: 'snacks', sellPrice: 5 };
const RICE = { id: 'rice', categoryId: 'grains', sellPrice: 99 };

describe('which presets fit (POS-03)', () => {
  test('every product, chosen products, chosen categories', () => {
    expect(covers(SUKI, RICE)).toBe(true);
    expect(covers(FIVE_OFF, CHIPS)).toBe(true);
    expect(covers(FIVE_OFF, RICE)).toBe(false);
    expect(covers(GRAINS, RICE)).toBe(true);
    expect(covers(GRAINS, CHIPS)).toBe(false);
  });

  test('a fixed amount is not offered on a product priced at or below it (Nov 12)', () => {
    expect(covers(FIVE_OFF, CANDY)).toBe(false);
    expect(covers({ ...FIVE_OFF, value: 4.99 }, CANDY)).toBe(true);
  });

  test('a preset switched off is never offered', () => {
    expect(covers({ ...SUKI, active: false }, CHIPS)).toBe(false);
  });

  test('the offers for a product, by name', () => {
    expect(rulesFor([SUKI, GRAINS, FIVE_OFF], CHIPS).map((rule) => rule.name)).toEqual([
      '₱5 off chips',
      'Suki 10%',
    ]);
  });
});

describe('what a preset takes off, as the server works it out', () => {
  test('a percent of the line total, to the centavo (Nov 12)', () => {
    expect(discountCents(SUKI, 3, 45)).toBe(1350);
    // ₱99.99 × 12.5% = ₱12.49875 → ₱12.50 (half up).
    expect(discountCents({ ...SUKI, value: 12.5 }, 3, 33.33)).toBe(1250);
    // 0.333 kg × ₱99 = ₱32.97 (half up); 10% = ₱3.297 → ₱3.30.
    expect(discountCents(SUKI, 0.333, 99)).toBe(330);
  });

  test('a fixed amount off each unit, or each kg', () => {
    expect(discountCents(FIVE_OFF, 2, 45)).toBe(1000);
    expect(discountCents(GRAINS, 1.25, 99)).toBe(1250);
  });

  test('a cart line gets its picked preset while it still fits', () => {
    expect(lineDiscount([SUKI], { discountId: 'd1', qty: 3 }, CHIPS)).toEqual({
      id: 'd1',
      name: 'Suki 10%',
      amount: 13.5,
    });
    expect(lineDiscount([SUKI], { qty: 3 }, CHIPS)).toBeUndefined();
    expect(lineDiscount([{ ...SUKI, active: false }], { discountId: 'd1', qty: 3 }, CHIPS)).toBe(
      undefined,
    );
    expect(lineDiscount([FIVE_OFF], { discountId: 'd2', qty: 1 }, RICE)).toBeUndefined();
  });
});

test('how presets read', () => {
  expect(ruleAmount(SUKI)).toBe('10% off');
  expect(ruleAmount({ ...SUKI, value: 12.5 })).toBe('12.5% off');
  expect(ruleAmount(FIVE_OFF, 'pack')).toBe('₱5.00 off each');
  expect(ruleAmount(GRAINS, 'kg')).toBe('₱10.00 off per kg');
  expect(targetText(SUKI)).toBe('Every product');
  expect(targetText(FIVE_OFF)).toBe('2 products');
  expect(targetText(GRAINS)).toBe('1 category');
});
