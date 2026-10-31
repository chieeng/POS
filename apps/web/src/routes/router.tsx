import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage';
import { MyRequestsPage } from '@/features/approvals/MyRequestsPage';
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { AddProductPage } from '@/features/catalog/AddProductPage';
import { CatalogLayout } from '@/features/catalog/CatalogLayout';
import { CategoriesPage } from '@/features/catalog/CategoriesPage';
import { ProductDetailPage } from '@/features/catalog/ProductDetailPage';
import { ProductsPage } from '@/features/catalog/ProductsPage';
import { SuppliersPage } from '@/features/catalog/SuppliersPage';
import { BackupsPage } from '@/features/backups/BackupsPage';
import { AttendanceSettingsPage } from '@/features/store/AttendanceSettingsPage';
import { NewStockInPage } from '@/features/stock/NewStockInPage';
import { StockInListPage } from '@/features/stock/StockInListPage';
import { StockReceiptPage } from '@/features/stock/StockReceiptPage';
import { StoreSettingsPage } from '@/features/store/StoreSettingsPage';
import { EnrollTotpPage } from '@/features/auth/EnrollTotpPage';
import { ROLE_HOME } from '@/features/auth/roles';
import { SetPasswordPage } from '@/features/auth/SetPasswordPage';
import { HomePage } from '@/features/home/HomePage';
import { SettingsLayout } from '@/features/settings/SettingsLayout';
import { AddUserPage } from '@/features/users/AddUserPage';
import { UserDetailPage } from '@/features/users/UserDetailPage';
import { UsersPage } from '@/features/users/UsersPage';
import { RequireRole, RoleRedirect, SettingsIndex, SignInRoute } from './guards';
import { ProtectedLayout } from './ProtectedLayout';
import { SET_PASSWORD_PATH, TWO_STEP_SETUP_PATH } from './paths';

// There is deliberately no sign-up route: accounts are created only by the Owner (SEC-01).
export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInRoute /> },
  { path: SET_PASSWORD_PATH, element: <SetPasswordPage /> },
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
              { path: '/approvals', element: <ApprovalsPage /> },
              {
                path: '/settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <SettingsIndex /> },
                  { path: 'store', element: <StoreSettingsPage /> },
                  { path: 'attendance', element: <AttendanceSettingsPage /> },
                  { path: 'users', element: <UsersPage /> },
                  { path: 'users/new', element: <AddUserPage /> },
                  { path: 'users/:uid', element: <UserDetailPage /> },
                  { path: 'audit-log', element: <AuditLogPage /> },
                  { path: 'backups', element: <BackupsPage /> },
                ],
              },
            ],
          },
          {
            // INV-02: stock-in by the Owner and Special Sales.
            element: <RequireRole role={['owner', 'special_sales']} />,
            children: [
              { path: '/stock-in', element: <StockInListPage /> },
              { path: '/stock-in/new', element: <NewStockInPage /> },
              { path: '/stock-in/:receiptId', element: <StockReceiptPage /> },
            ],
          },
          {
            // SRS 6.1: everyone sees products; the Owner and Special Sales add products and
            // manage categories and suppliers. The database enforces the same rules.
            path: '/products',
            element: <CatalogLayout />,
            children: [
              { index: true, element: <ProductsPage /> },
              {
                element: <RequireRole role={['owner', 'special_sales']} />,
                children: [
                  { path: 'new', element: <AddProductPage /> },
                  { path: 'categories', element: <CategoriesPage /> },
                  { path: 'suppliers', element: <SuppliersPage /> },
                ],
              },
              { path: ':productId', element: <ProductDetailPage /> },
            ],
          },
          {
            element: <RequireRole role="special_sales" />,
            children: [
              { path: ROLE_HOME.special_sales, element: <HomePage role="special_sales" /> },
              { path: '/requests', element: <MyRequestsPage /> },
            ],
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
