import { Navigate, Outlet } from 'react-router-dom';
import { ROLE_HOME, type Role } from '@/features/auth/roles';
import { SignInPage } from '@/features/auth/SignInPage';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSession } from '@/stores/session';
import { SplashScreen } from './ProtectedLayout';

/** Sends a signed-in user to the home for their role. */
export function RoleRedirect() {
  const user = useSession((s) => s.user);
  if (!user) return <Navigate to="/sign-in" replace />;
  return <Navigate to={ROLE_HOME[user.role]} replace />;
}

/** Keeps a user out of another role's screens. UX only; see ProtectedLayout. */
export function RequireRole({ role }: { role: Role }) {
  const user = useSession((s) => s.user);
  if (!user) return <Navigate to="/sign-in" replace />;
  if (user.role !== role) return <Navigate to={ROLE_HOME[user.role]} replace />;
  return <Outlet />;
}

export function SignInRoute() {
  const status = useSession((s) => s.status);
  return status === 'loading' ? <SplashScreen /> : <SignInPage />;
}

/** /settings itself: phones show the section list; wider screens open the first section. */
export function SettingsIndex() {
  const wide = useMediaQuery('(min-width: 768px)');
  return wide ? <Navigate to="store" replace /> : null;
}
