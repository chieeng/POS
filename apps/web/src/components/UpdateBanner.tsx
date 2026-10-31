import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Alert, AlertAction } from '@/components/ui/alert';

// How often an open app looks for a new version, so a phone left on all day still updates.
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Registers the service worker that makes the app installable and lets it open offline
 * (NFR-03). When a new version has been deployed it waits, and this banner asks the user to
 * reload, so nobody loses what they were typing to an automatic reload.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update().catch(() => undefined);
      }, UPDATE_CHECK_MS);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <Alert
        variant="info"
        icon={RefreshCw}
        className="pointer-events-auto w-full max-w-[480px] shadow-[var(--shadow-lg)]"
        action={
          <AlertAction onClick={() => void updateServiceWorker(true)}>Reload now</AlertAction>
        }
      >
        A new version of the app is ready. Reload when you have finished what you are doing.
      </Alert>
    </div>
  );
}
