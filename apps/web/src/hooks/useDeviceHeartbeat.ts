import { useEffect } from 'react';
import { registerDevice } from '@/lib/device';

// "Active now" means seen in the last 5 minutes (describeLastSeen), so 4 minutes keeps an
// open, visible app "Active now" with about 15 small writes an hour per device.
export const HEARTBEAT_MS = 4 * 60_000;
// Shared by every tab of this browser, so two open tabs still write only once per interval.
const LAST_STAMP_KEY = 'pos.lastSeenStamp';

function lastStamp(uid: string): number {
  try {
    const [owner, at] = (localStorage.getItem(LAST_STAMP_KEY) ?? '').split(':');
    return owner === uid ? Number(at) || 0 : 0;
  } catch {
    return 0;
  }
}

function rememberStamp(uid: string, at: number) {
  try {
    localStorage.setItem(LAST_STAMP_KEY, `${uid}:${at}`);
  } catch {
    // Storage unavailable: this tab just stamps on its own schedule.
  }
}

/**
 * SYS-02: records this device under the signed-in user when the session starts, then keeps
 * its "last seen" time fresh while the app is open and in use: every 4 minutes while the page
 * is visible, online and not idle-locked, and on coming back to it. The server sets the time.
 */
export function useDeviceHeartbeat(uid: string | undefined, enabled: boolean, locked: boolean) {
  // Once per session, whatever the screen state: this is also how a new device is registered.
  useEffect(() => {
    if (!enabled || !uid) return;
    rememberStamp(uid, Date.now());
    registerDevice({ uid }).catch(() => {
      // Not critical: the next stamp or session tries again.
    });
  }, [enabled, uid]);

  useEffect(() => {
    if (!enabled || !uid || locked) return;

    const stampIfDue = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const now = Date.now();
      // A little slack, so a timer that fires early does not skip a whole interval.
      if (now - lastStamp(uid) < HEARTBEAT_MS - 30_000) return;
      rememberStamp(uid, now);
      registerDevice({ uid }).catch(() => {
        // Offline or a passing error: the next interval tries again.
      });
    };

    stampIfDue();
    const timer = setInterval(stampIfDue, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', stampIfDue);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', stampIfDue);
    };
  }, [enabled, uid, locked]);
}
