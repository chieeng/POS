import { expect, test } from 'vitest';
import { describeAuthError } from './authErrors';

test.each([
  ['auth/invalid-credential', 'wrong-credentials'],
  ['auth/wrong-password', 'wrong-credentials'],
  ['auth/user-not-found', 'wrong-credentials'],
  ['auth/user-disabled', 'disabled'],
  ['auth/too-many-requests', 'too-many-attempts'],
  ['auth/network-request-failed', 'offline'],
  ['auth/invalid-verification-code', 'wrong-code'],
  ['auth/something-new', 'unknown'],
])('%s maps to %s', (code, kind) => {
  expect(describeAuthError({ code }).kind).toBe(kind);
});

test('a wrong email and a wrong password read the same (no account enumeration)', () => {
  expect(describeAuthError({ code: 'auth/user-not-found' })).toEqual(
    describeAuthError({ code: 'auth/wrong-password' }),
  );
});

test('non-Firebase errors are unknown', () => {
  expect(describeAuthError(new Error('boom')).kind).toBe('unknown');
});
