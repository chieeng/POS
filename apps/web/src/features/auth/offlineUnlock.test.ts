import { beforeEach, expect, test } from 'vitest';
import {
  checkOfflinePassword,
  forgetOfflineUnlock,
  hasOfflineUnlock,
  makeUnlockRecord,
  OFFLINE_TRIES,
  rememberPassword,
  UNLOCK_ITERATIONS,
} from './offlineUnlock';

const FAST = 1_000;
const STORAGE_KEY = 'pos.unlockCheck';

beforeEach(() => {
  localStorage.clear();
});

test('keeps a salted hash, never the password', async () => {
  await rememberPassword('u1', 'correct horse 12', FAST);
  const raw = localStorage.getItem(STORAGE_KEY) ?? '';
  expect(raw).not.toContain('correct horse');
  const stored = JSON.parse(raw) as { uid: string; salt: string; hash: string; iterations: number };
  expect(stored.uid).toBe('u1');
  expect(stored.iterations).toBe(FAST);
  expect(atob(stored.salt)).toHaveLength(16);
  expect(atob(stored.hash)).toHaveLength(32);
  expect(hasOfflineUnlock('u1')).toBe(true);
  expect(hasOfflineUnlock('u2')).toBe(false);
});

test('the default is 600,000 rounds, and the same password gets a different salt each time', async () => {
  expect(UNLOCK_ITERATIONS).toBe(600_000);
  const a = await makeUnlockRecord('u1', 'password12', FAST);
  const b = await makeUnlockRecord('u1', 'password12', FAST);
  expect(a.salt).not.toBe(b.salt);
  expect(a.hash).not.toBe(b.hash);
});

test('accepts the right password and refuses a wrong one', async () => {
  await rememberPassword('u1', 'password12', FAST);
  expect(await checkOfflinePassword('u1', 'password12')).toEqual({ result: 'ok' });
  expect(await checkOfflinePassword('u1', 'Password12')).toEqual({
    result: 'wrong',
    triesLeft: OFFLINE_TRIES - 1,
  });
});

test('another user, or no check yet, needs the internet', async () => {
  expect(await checkOfflinePassword('u1', 'password12')).toEqual({ result: 'none' });
  await rememberPassword('u1', 'password12', FAST);
  expect(await checkOfflinePassword('u2', 'password12')).toEqual({ result: 'none' });
});

test('five wrong tries in a row delete the check', async () => {
  await rememberPassword('u1', 'password12', FAST);
  for (let left = OFFLINE_TRIES - 1; left >= 0; left--) {
    expect(await checkOfflinePassword('u1', 'nope')).toEqual({ result: 'wrong', triesLeft: left });
  }
  expect(hasOfflineUnlock('u1')).toBe(false);
  expect(await checkOfflinePassword('u1', 'password12')).toEqual({ result: 'none' });
});

test('a right password resets the count of wrong tries', async () => {
  await rememberPassword('u1', 'password12', FAST);
  for (let i = 0; i < OFFLINE_TRIES - 1; i++) await checkOfflinePassword('u1', 'nope');
  expect(await checkOfflinePassword('u1', 'password12')).toEqual({ result: 'ok' });
  expect(await checkOfflinePassword('u1', 'nope')).toEqual({
    result: 'wrong',
    triesLeft: OFFLINE_TRIES - 1,
  });
});

test('forgetting removes the check, also one still being worked out', async () => {
  await rememberPassword('u1', 'password12', FAST);
  forgetOfflineUnlock();
  expect(hasOfflineUnlock('u1')).toBe(false);

  const pending = rememberPassword('u1', 'password12', FAST);
  forgetOfflineUnlock();
  await pending;
  expect(hasOfflineUnlock('u1')).toBe(false);
});

test('a damaged record is ignored', async () => {
  localStorage.setItem(STORAGE_KEY, '{"v":1,"uid":"u1"}');
  expect(hasOfflineUnlock('u1')).toBe(false);
  expect(await checkOfflinePassword('u1', 'password12')).toEqual({ result: 'none' });
});
