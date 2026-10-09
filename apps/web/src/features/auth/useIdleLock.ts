import { useEffect } from 'react';
import { useSession } from '@/stores/session';
import {
  IDLE_STORAGE_KEYS,
  isIdleExpired,
  readLastActivity,
  readLocked,
  writeLastActivity,
  writeLocked,
} from './idleStorage';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const CHECK_EVERY_MS = 15_000;
const WRITE_THROTTLE_MS = 5_000;

/**
 * AUTH-05: locks the app after `minutes` without activity. The lock state is shared by all
 * tabs and survives a reload. Runs only while someone is signed in.
 */
export function useIdleLock(minutes: number, enabled: boolean) {
  const setLocked = useSession((s) => s.setLocked);

  useEffect(() => {
    if (!enabled) return;
    let lastWrite = 0;

    const lock = () => {
      writeLocked(true);
      setLocked(true);
    };

    const check = () => {
      if (readLocked()) {
        setLocked(true);
      } else if (isIdleExpired(readLastActivity(), Date.now(), minutes)) {
        lock();
      }
    };

    const onActivity = () => {
      if (useSession.getState().locked) return;
      const now = Date.now();
      if (now - lastWrite < WRITE_THROTTLE_MS) return;
      // The timeout may have passed while this tab was in the background.
      if (isIdleExpired(readLastActivity(), now, minutes)) {
        lock();
        return;
      }
      lastWrite = now;
      writeLastActivity(now);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === IDLE_STORAGE_KEYS.LOCKED_KEY) setLocked(readLocked());
    };

    if (readLastActivity() === null) writeLastActivity(Date.now());
    check();

    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('storage', onStorage);
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('storage', onStorage);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
    };
  }, [minutes, enabled, setLocked]);
}

export function unlockIdle() {
  writeLastActivity(Date.now());
  writeLocked(false);
  useSession.getState().setLocked(false);
}
