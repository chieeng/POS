import { describe, expect, test } from 'vitest';
import { initialsOf, parseProfileAccess } from './roles';

describe('parseProfileAccess', () => {
  const valid = { role: 'sales', active: true, branch_id: 'main' };

  test('accepts each role with active true and a branch', () => {
    for (const role of ['owner', 'special_sales', 'sales']) {
      expect(parseProfileAccess({ ...valid, role })).toEqual({ role, branchId: 'main' });
    }
  });

  test('rejects an account without a profile', () => {
    expect(parseProfileAccess(null)).toBeNull();
    expect(parseProfileAccess(undefined)).toBeNull();
    expect(parseProfileAccess({})).toBeNull();
  });

  test('rejects an unknown role', () => {
    expect(parseProfileAccess({ ...valid, role: 'admin' })).toBeNull();
    expect(parseProfileAccess({ ...valid, role: 'specialSales' })).toBeNull();
  });

  test('rejects active false, missing or non-boolean', () => {
    expect(parseProfileAccess({ ...valid, active: false })).toBeNull();
    expect(parseProfileAccess({ role: 'sales', branch_id: 'main' })).toBeNull();
    expect(parseProfileAccess({ ...valid, active: 'true' })).toBeNull();
  });

  test('rejects a missing branch', () => {
    expect(parseProfileAccess({ role: 'sales', active: true })).toBeNull();
    expect(parseProfileAccess({ ...valid, branch_id: '' })).toBeNull();
  });
});

test('initialsOf takes the first letters of the first two words', () => {
  expect(initialsOf('Rosario Santos')).toBe('RS');
  expect(initialsOf('jun')).toBe('J');
  expect(initialsOf('Ana Maria Cruz')).toBe('AM');
});
