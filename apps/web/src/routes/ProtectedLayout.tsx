import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { IdleLock } from '@/features/auth/IdleLock';
import { IDLE_LOCK_MINUTES_DEFAULT } from '@/features/auth/idleStorage';
import { useIdleLock } from '@/features/auth/useIdleLock';
import { useSession } from '@/stores/session';
import { TWO_STEP_SETUP_PATH } from './paths';

/**
 * Wraps every signed-in screen. This is for navigation only: what a user can actually read
 * or change is decided by Security Rules and Cloud Functions (NFR-04).
 */
export function ProtectedLayout() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const locked = useSession((s) => s.locked);
  const location = useLocation();
  // The branch's idleLockMinutes setting (SYS-01) replaces this default with the settings screen.
  const idleMinutes = IDLE_LOCK_MINUTES_DEFAULT;
  useIdleLock(idleMinutes, status === 'signedIn');

  if (status === 'loading') return <SplashScreen />;
  if (status === 'signedOut' || !user) return <Navigate to="/sign-in" replace />;

  // SEC-05: an Owner session without the authenticator step can only set it up.
  const needsTwoStep = user.role === 'owner' && !user.secondFactor;
  if (needsTwoStep && location.pathname !== TWO_STEP_SETUP_PATH) {
    return <Navigate to={TWO_STEP_SETUP_PATH} replace />;
  }
  if (!needsTwoStep && location.pathname === TWO_STEP_SETUP_PATH) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <div
        className={locked ? 'pointer-events-none opacity-60 blur-[14px] select-none' : undefined}
        aria-hidden={locked || undefined}
        {...(locked ? { inert: '' } : {})}
      >
        <Outlet />
      </div>
      {locked && <IdleLock user={user} minutes={idleMinutes} />}
    </>
  );
}

export function SplashScreen() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <div className="font-heading text-[64px] leading-none">POS</div>
    </div>
  );
}
