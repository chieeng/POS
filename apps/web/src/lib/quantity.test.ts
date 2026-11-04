import { describe, expect, test } from 'vitest';
import {
  formatQty,
  isSoldByMeasure,
  minQty,
  parseQty,
  qtyInputMode,
  qtyRule,
  qtyWithUnit,
  signedQty,
} from './quantity';

describe('quantities (PROD-01)', () => {
  test('kg and L are sold by weight or volume; every other unit is whole', () => {
    expect(isSoldByMeasure('kg')).toBe(true);
    expect(isSoldByMeasure('L')).toBe(true);
    expect(isSoldByMeasure('l')).toBe(false);
    expect(isSoldByMeasure('pc')).toBe(false);
    expect(minQty('kg')).toBe(0.001);
    expect(minQty('pack')).toBe(1);
    expect(qtyInputMode('L')).toBe('decimal');
    expect(qtyInputMode('box')).toBe('numeric');
  });

  test('kg and L take up to 3 decimals', () => {
    expect(parseQty('1.25', 'kg')).toBe(1.25);
    expect(parseQty(' .5 ', 'kg')).toBe(0.5);
    expect(parseQty('2.', 'L')).toBe(2);
    expect(parseQty('0.001', 'kg')).toBe(0.001);
    expect(parseQty('1.2345', 'kg')).toBeNull();
    expect(parseQty('1,5', 'kg')).toBeNull();
    expect(parseQty('-1', 'kg')).toBeNull();
    expect(parseQty('', 'kg')).toBeNull();
  });

  test('other units take whole numbers only', () => {
    expect(parseQty('12', 'pc')).toBe(12);
    expect(parseQty('1.5', 'pc')).toBeNull();
    expect(parseQty('1.0', 'pack')).toBeNull();
    expect(parseQty('abc', 'pc')).toBeNull();
  });

  test('are written with no trailing zeros and no float noise', () => {
    expect(formatQty(12)).toBe('12');
    expect(formatQty(1.25)).toBe('1.25');
    expect(formatQty(0.1 + 0.2)).toBe('0.3');
    expect(formatQty(-0.0001)).toBe('0');
    expect(formatQty(1234567.5)).toBe('1234567.5');
    expect(formatQty(Number.NaN)).toBe('—');
    expect(qtyWithUnit(2.5, 'kg')).toBe('2.5 kg');
    expect(signedQty(-0.25)).toBe('−0.25');
    expect(signedQty(3)).toBe('+3');
  });

  test('the rule says what to type', () => {
    expect(qtyRule('pc')).toBe('enter a whole quantity of at least 1.');
    expect(qtyRule('pc', { zeroAllowed: true })).toBe('enter a whole quantity (0 takes it off).');
    expect(qtyRule('L')).toBe('enter a quantity in L, up to 3 decimals, for example 1.25.');
  });
});
