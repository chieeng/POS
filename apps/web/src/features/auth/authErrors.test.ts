import { expect, test } from 'vitest';
import { describeAuthError } from './authErrors';

test.each([
  ['invalid_credentials', 'wrong-credentials'],
  ['validation_failed', 'wrong-credentials'],
  ['user_not_found', 'wrong-credentials'],
  ['user_banned', 'disabled'],
  ['over_request_rate_limit', 'too-many-attempts'],
  ['mfa_verification_failed', 'wrong-code'],
  ['mfa_challenge_expired', 'wrong-code'],
  ['session_not_found', 'recent-sign-in-needed'],
  ['no_session', 'recent-sign-in-needed'],
  ['captcha_unavailable', 'offline'],
  ['captcha_failed', 'unknown'],
  ['something_new', 'unknown'],
])('%s maps to %s', (code, kind) => {
  expect(describeAuthError({ code }).kind).toBe(kind);
});

test('a wrong email and a wrong password read the same (no account enumeration)', () => {
  expect(describeAuthError({ code: 'user_not_found' })).toEqual(
    describeAuthError({ code: 'invalid_credentials' }),
  );
});

test('errors that are not from Supabase are unknown', () => {
  expect(describeAuthError(new Error('boom')).kind).toBe('unknown');
  expect(describeAuthError(null).kind).toBe('unknown');
});

test('a request that never reached the server reads as offline', () => {
  expect(describeAuthError({ name: 'AuthRetryableFetchError', status: 0 }).kind).toBe('offline');
  expect(describeAuthError(new TypeError('Failed to fetch')).kind).toBe('offline');
});

test('any rate-limited request reads as too many tries', () => {
  expect(describeAuthError({ status: 429, code: 'over_email_send_rate_limit' }).kind).toBe(
    'too-many-attempts',
  );
});
