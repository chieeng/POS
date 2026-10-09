import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { EnrollTotpPage } from '@/features/auth/EnrollTotpPage';
import { ROLE_HOME } from '@/features/auth/roles';
import { HomePage } from '@/features/home/HomePage';
import { RequireRole, RoleRedirect, SignInRoute } from './guards';
import { ProtectedLayout } from './ProtectedLayout';
import { TWO_STEP_SETUP_PATH } from './paths';

// There is deliberately no sign-up route: accounts are created only by the Owner (SEC-01).
export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInRoute /> },
  {
    element: <ProtectedLayout />,
    children: [
      { path: '/', element: <RoleRedirect /> },
      { path: TWO_STEP_SETUP_PATH, element: <EnrollTotpPage /> },
      {
        element: <RequireRole role="owner" />,
        children: [{ path: ROLE_HOME.owner, element: <HomePage role="owner" /> }],
      },
      {
        element: <RequireRole role="specialSales" />,
        children: [{ path: ROLE_HOME.specialSales, element: <HomePage role="specialSales" /> }],
      },
      {
        element: <RequireRole role="sales" />,
        children: [{ path: ROLE_HOME.sales, element: <HomePage role="sales" /> }],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
