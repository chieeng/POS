import { useSyncExternalStore } from 'react';
import { isOnline, subscribeConnection } from '@/lib/connection';

/**
 * Whether the app can reach the internet: the browser's network link and the connection
 * check (lib/connection.ts), so Wi-Fi without internet reads as offline too. Every screen
 * reads this one status.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeConnection, isOnline, () => true);
}

function subscribeBrowser(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/**
 * The browser's network link only. For the unlock screen, where a wrong "offline" would stop
 * someone from unlocking: there the server's own answer decides.
 */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    subscribeBrowser,
    () => navigator.onLine,
    () => true,
  );
}
