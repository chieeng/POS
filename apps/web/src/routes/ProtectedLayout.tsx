import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { IdleLock } from '@/features/auth/IdleLock';
import { IDLE_LOCK_MINUTES_DEFAULT } from '@/features/auth/idleStorage';
import { useIdleLock } from '@/features/auth/useIdleLock';
import { SignOutBlockedDialog } from '@/features/outbox/SignOutBlockedDialog';
import { BranchContext, useBranchQuery } from '@/features/store/data';
import { useDeviceHeartbeat } from '@/hooks/useDeviceHeartbeat';
import { useSession } from '@/stores/session';
import { SET_PASSWORD_PATH, TWO_STEP_SETUP_PATH } from './paths';

/**
 * Wraps every signed-in screen. This is for navigation only: what a user can actually read
 * or change is decided by Row Level Security and server functions (NFR-04).
 */
export function ProtectedLayout() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const locked = useSession((s) => s.locked);
  const passwordSetup = useSession((s) => s.passwordSetup);
  const location = useLocation();
  // SYS-01: the signed-in user's branch, live, shared with every screen below. Its idle lock
  // time applies on every device; until it loads, the default applies.
  const branch = useBranchQuery(status === 'signedIn' ? user?.branchId : undefined);
  const idleMinutes = branch.data[0]?.idleLockMinutes ?? IDLE_LOCK_MINUTES_DEFAULT;
  useIdleLock(idleMinutes, status === 'signedIn');

  // SYS-02: record this device under the signed-in user and keep its "last seen" fresh.
  const canRegister = status === 'signedIn' && (user?.role !== 'owner' || user.secondFactor);
  useDeviceHeartbeat(user?.uid, canRegister, locked);

  if (status === 'loading') return <SplashScreen />;
  if (status === 'signedOut' || !user) return <Navigate to="/sign-in" replace />;

  // AUTH-02: someone who opened a one-time password link chooses their password first.
  if (passwordSetup) return <Navigate to={SET_PASSWORD_PATH} replace />;

  // SEC-05: an Owner session without the authenticator step can only set it up.
  const needsTwoStep = user.role === 'owner' && !user.secondFactor;
  if (needsTwoStep && location.pathname !== TWO_STEP_SETUP_PATH) {
    return <Navigate to={TWO_STEP_SETUP_PATH} replace />;
  }
  if (!needsTwoStep && location.pathname === TWO_STEP_SETUP_PATH) {
    return <Navigate to="/" replace />;
  }

  return (
    <BranchContext.Provider value={branch}>
      <div
        className={locked ? 'pointer-events-none opacity-60 blur-[14px] select-none' : undefined}
        aria-hidden={locked || undefined}
        {...(locked ? { inert: '' } : {})}
      >
        <Outlet />
      </div>
      {locked && <IdleLock user={user} minutes={idleMinutes} />}
      <SignOutBlockedDialog />
    </BranchContext.Provider>
  );
}

export function SplashScreen() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <div className="font-heading text-[64px] leading-none">POS</div>
    </div>
  );
}
