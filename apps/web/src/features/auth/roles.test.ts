import { describe, expect, test } from 'vitest';
import { initialsOf, parseAccessClaims } from './roles';

describe('parseAccessClaims', () => {
  const valid = { role: 'sales', active: true, branchId: 'main' };

  test('accepts each role with active true and a branch', () => {
    for (const role of ['owner', 'specialSales', 'sales']) {
      expect(parseAccessClaims({ ...valid, role })?.role).toBe(role);
    }
  });

  test('rejects an account without claims', () => {
    expect(parseAccessClaims({})).toBeNull();
  });

  test('rejects an unknown role', () => {
    expect(parseAccessClaims({ ...valid, role: 'admin' })).toBeNull();
  });

  test('rejects active false, missing or non-boolean', () => {
    expect(parseAccessClaims({ ...valid, active: false })).toBeNull();
    expect(parseAccessClaims({ role: 'sales', branchId: 'main' })).toBeNull();
    expect(parseAccessClaims({ ...valid, active: 'true' })).toBeNull();
  });

  test('rejects a missing branch', () => {
    expect(parseAccessClaims({ role: 'sales', active: true })).toBeNull();
    expect(parseAccessClaims({ ...valid, branchId: '' })).toBeNull();
  });

  test('reports whether the sign-in used the authenticator app', () => {
    expect(parseAccessClaims(valid)?.secondFactor).toBe(false);
    expect(
      parseAccessClaims({ ...valid, firebase: { sign_in_second_factor: 'totp' } })?.secondFactor,
    ).toBe(true);
  });
});

test('initialsOf takes the first letters of the first two words', () => {
  expect(initialsOf('Rosario Santos')).toBe('RS');
  expect(initialsOf('jun')).toBe('J');
  expect(initialsOf('Ana Maria Cruz')).toBe('AM');
});
