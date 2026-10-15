/**
 * Idle-lock state (AUTH-05) lives in localStorage so that a reload or a second tab cannot
 * skip the lock. The lock is a convenience against a found, unlocked phone (SEC-13); it is
 * not a security boundary, which is why nothing here is trusted by the server.
 */
export const IDLE_LOCK_MINUTES_DEFAULT = 15;

const LAST_ACTIVITY_KEY = 'pos.lastActivity';
const LOCKED_KEY = 'pos.locked';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the lock still works in memory for this tab.
  }
}

export function readLastActivity(): number | null {
  const value = Number(read(LAST_ACTIVITY_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function writeLastActivity(now: number) {
  write(LAST_ACTIVITY_KEY, String(now));
}

export function readLocked(): boolean {
  return read(LOCKED_KEY) === '1';
}

export function writeLocked(locked: boolean) {
  write(LOCKED_KEY, locked ? '1' : null);
}

export function clearIdleState() {
  write(LAST_ACTIVITY_KEY, null);
  write(LOCKED_KEY, null);
}

export function isIdleExpired(lastActivity: number | null, now: number, minutes: number): boolean {
  if (lastActivity === null) return false;
  return now - lastActivity >= minutes * 60_000;
}

export const IDLE_STORAGE_KEYS = { LAST_ACTIVITY_KEY, LOCKED_KEY } as const;
