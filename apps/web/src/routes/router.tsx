import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { EnrollTotpPage } from '@/features/auth/EnrollTotpPage';
import { ROLE_HOME } from '@/features/auth/roles';
import { HomePage } from '@/features/home/HomePage';
import { SettingsLayout } from '@/features/settings/SettingsLayout';
import { AddUserPage } from '@/features/users/AddUserPage';
import { UserDetailPage } from '@/features/users/UserDetailPage';
import { UsersPage } from '@/features/users/UsersPage';
import { RequireRole, RoleRedirect, SettingsIndex, SignInRoute } from './guards';
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
        element: <AppShell />,
        children: [
          {
            element: <RequireRole role="owner" />,
            children: [
              { path: ROLE_HOME.owner, element: <HomePage role="owner" /> },
              {
                path: '/settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <SettingsIndex /> },
                  { path: 'users', element: <UsersPage /> },
                  { path: 'users/new', element: <AddUserPage /> },
                  { path: 'users/:uid', element: <UserDetailPage /> },
                  { path: 'audit-log', element: <AuditLogPage /> },
                ],
              },
            ],
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
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
