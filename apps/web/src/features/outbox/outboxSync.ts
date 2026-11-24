import { registerClockSenders } from '@/features/attendance/clock';
import { registerSaleSender } from '@/features/sales/data';
import { onReconnect } from '@/lib/connection';
import { syncOutbox } from '@/lib/outbox';
import { useSession } from '@/stores/session';

// NFR-02: what waited offline is sent within a minute of the connection coming back. The
// `online` event sends at once; this timer covers a connection the browser did not notice.
export const OUTBOX_SYNC_MS = 30_000;

/** Sends the signed-in user's outbox on start, when back online, and every 30 seconds. */
export function startOutboxSync(): () => void {
  const stopSales = registerSaleSender();
  const stopClock = registerClockSenders();
  const run = () => {
    const { status, user } = useSession.getState();
    if (status === 'signedIn' && user) void syncOutbox(user.uid);
  };
  run();
  const timer = setInterval(run, OUTBOX_SYNC_MS);
  window.addEventListener('online', run);
  // Wi-Fi whose internet comes back fires no `online` event: the connection check tells us.
  const stopReconnect = onReconnect(run);
  const unsubscribe = useSession.subscribe((state, before) => {
    if (state.status === 'signedIn' && state.user?.uid !== before.user?.uid) run();
  });
  return () => {
    stopSales();
    stopClock();
    clearInterval(timer);
    window.removeEventListener('online', run);
    stopReconnect();
    unsubscribe();
  };
}
