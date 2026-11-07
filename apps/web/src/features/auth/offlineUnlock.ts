/**
 * AUTH-05: unlocking the idle lock without internet. At each online sign-in, password set-up
 * or online unlock, the device keeps a slow salted hash of the password (PBKDF2-SHA-256,
 * 600,000 rounds, a random 16-byte salt), never the password itself. Offline, the password
 * typed on the lock screen is checked against it.
 *
 * The lock is a convenience against a found, unlocked phone (SEC-13), not a security boundary:
 * the server trusts nothing here. After OFFLINE_TRIES wrong passwords in a row the hash is
 * deleted, so guessing on the lock screen stops and the phone needs the internet to unlock.
 * The hash is deleted on sign-out, and when the server ends the session.
 */
export const UNLOCK_ITERATIONS = 600_000;
export const OFFLINE_TRIES = 5;

const STORAGE_KEY = 'pos.unlockCheck';

export interface UnlockRecord {
  v: 1;
  uid: string;
  salt: string;
  iterations: number;
  hash: string;
  /** Wrong offline tries in a row. */
  failures: number;
}

export type OfflineCheck =
  { result: 'ok' } | { result: 'wrong'; triesLeft: number } | { result: 'none' };

// Bumped by every forget, so a hash still being worked out for a session that has since
// ended is never saved.
let generation = 0;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Compares every byte, so the time taken does not tell how much matched. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function read(): UnlockRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UnlockRecord>;
    if (
      parsed.v !== 1 ||
      typeof parsed.uid !== 'string' ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.hash !== 'string' ||
      typeof parsed.iterations !== 'number' ||
      parsed.iterations < 1
    ) {
      return null;
    }
    return { ...(parsed as UnlockRecord), failures: Number(parsed.failures) || 0 };
  } catch {
    return null;
  }
}

function write(record: UnlockRecord | null) {
  try {
    if (record) localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: offline unlock just will not work on this device.
  }
}

export async function makeUnlockRecord(
  uid: string,
  password: string,
  iterations = UNLOCK_ITERATIONS,
): Promise<UnlockRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return { v: 1, uid, salt: toBase64(salt), iterations, hash: toBase64(hash), failures: 0 };
}

/**
 * Keeps the check for this user's password, replacing any earlier one. Runs in the background
 * after the server accepted the password; a failure only means no offline unlock.
 */
export async function rememberPassword(
  uid: string,
  password: string,
  iterations = UNLOCK_ITERATIONS,
): Promise<void> {
  const started = generation;
  try {
    const record = await makeUnlockRecord(uid, password, iterations);
    if (generation === started) write(record);
  } catch {
    // No Web Crypto (an old browser, or not https): offline unlock is not available.
  }
}

/** Removes the check: sign-out, an ended session, or a half-finished sign-in. */
export function forgetOfflineUnlock() {
  generation += 1;
  write(null);
}

export function hasOfflineUnlock(uid: string): boolean {
  return read()?.uid === uid;
}

export async function checkOfflinePassword(uid: string, password: string): Promise<OfflineCheck> {
  const record = read();
  if (!record || record.uid !== uid) return { result: 'none' };
  const hash = await derive(password, fromBase64(record.salt), record.iterations);
  if (sameBytes(hash, fromBase64(record.hash))) {
    if (record.failures) write({ ...record, failures: 0 });
    return { result: 'ok' };
  }
  const failures = record.failures + 1;
  const triesLeft = Math.max(OFFLINE_TRIES - failures, 0);
  if (triesLeft === 0) forgetOfflineUnlock();
  else write({ ...record, failures });
  return { result: 'wrong', triesLeft };
}
