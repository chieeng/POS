import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Role } from '@/features/auth/roles';
import { useSession, type SessionUser } from '@/stores/session';
import { routes } from './router';

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {}, passwordLinkFailed: false }));
vi.mock('@/lib/device', () => ({
  registerDevice: vi.fn(() => Promise.resolve()),
  getDeviceTag: () => 'A1B2',
}));
vi.mock('@/features/users/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/users/data')>()),
  useUsers: () => ({ data: [], loading: false, error: false }),
  useDevices: () => ({ data: [], loading: false, error: false }),
  useAuditLogs: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('@/features/approvals/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/approvals/data')>()),
  useApprovalRequests: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('@/features/catalog/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/data')>()),
  useCategories: () => ({ data: [], loading: false, error: false }),
  useSuppliers: () => ({ data: [], loading: false, error: false }),
  useProducts: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('@/features/store/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/store/data')>()),
  useBranchQuery: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('@/features/backups/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/backups/data')>()),
  useBackups: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('@/features/auth/authService', () => ({
  signIn: vi.fn(),
  verifyTotp: vi.fn(),
  signOutUser: vi.fn(),
  confirmPassword: vi.fn(),
  startTotpEnrollment: vi.fn(() => new Promise(() => {})),
  finishTotpEnrollment: vi.fn(),
  cancelSecondStep: vi.fn(),
  pendingSecondStep: vi.fn(() => Promise.resolve(null)),
  setNewPassword: vi.fn(),
}));

function userWith(role: Role, secondFactor = role === 'owner'): SessionUser {
  return {
    uid: 'u',
    email: 'a@b.c',
    displayName: 'Test User',
    role,
    branchId: 'main',
    secondFactor,
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  localStorage.clear();
  useSession.setState({
    status: 'signedOut',
    user: null,
    notice: null,
    locked: false,
    passwordSetup: false,
  });
});

test('a signed-out visitor is sent to sign-in', async () => {
  const router = renderAt('/owner');
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
});

test.each([
  ['owner', '/owner', 'Owner home'],
  ['special_sales', '/special-sales', 'Special Sales home'],
  ['sales', '/sales', 'Sales home'],
] as const)('%s lands on their own home', async (role, path, heading) => {
  useSession.setState({ status: 'signedIn', user: userWith(role) });
  const router = renderAt('/');
  expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(path);
});

test('a Sales user cannot open the Owner home', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('sales') });
  const router = renderAt('/owner');
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
});

test('an Owner without the authenticator step can only set it up (SEC-05)', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('owner', false) });
  const router = renderAt('/owner');
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/set-up-two-step'));
  expect(
    await screen.findByRole('heading', { name: 'Turn on two-step sign-in' }),
  ).toBeInTheDocument();
});

test('there is no sign-up route (SEC-01)', async () => {
  const router = renderAt('/sign-up');
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
});

test.each(['sales', 'special_sales'] as const)('%s cannot open Settings', async (role) => {
  useSession.setState({ status: 'signedIn', user: userWith(role) });
  const router = renderAt('/settings/users');
  await vi.waitFor(() => expect(router.state.location.pathname).not.toContain('/settings'));
});

test('the Owner opens Settings > Users', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('owner') });
  renderAt('/settings/users');
  expect(await screen.findByRole('link', { name: /Add user/ })).toBeInTheDocument();
});

test('the Owner opens Settings > Backups (SYS-04)', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('owner') });
  renderAt('/settings/backups');
  expect(await screen.findByRole('heading', { name: 'Backups' })).toBeInTheDocument();
});

test.each(['sales', 'special_sales'] as const)(
  '%s cannot open Settings > Backups',
  async (role) => {
    useSession.setState({ status: 'signedIn', user: userWith(role) });
    const router = renderAt('/settings/backups');
    await vi.waitFor(() => expect(router.state.location.pathname).not.toContain('/settings'));
  },
);

test('the Owner opens Settings > Store (SYS-01)', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('owner') });
  renderAt('/settings/store');
  expect(await screen.findByRole('heading', { name: 'Store' })).toBeInTheDocument();
});

test.each(['sales', 'special_sales'] as const)('%s cannot open Settings > Store', async (role) => {
  useSession.setState({ status: 'signedIn', user: userWith(role) });
  const router = renderAt('/settings/store');
  await vi.waitFor(() => expect(router.state.location.pathname).not.toContain('/settings'));
});

test('the Owner opens Settings > Attendance (ATT-07)', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('owner') });
  renderAt('/settings/attendance');
  expect(await screen.findByRole('heading', { name: 'Attendance' })).toBeInTheDocument();
});

test.each(['sales', 'special_sales'] as const)(
  '%s cannot open Settings > Attendance',
  async (role) => {
    useSession.setState({ status: 'signedIn', user: userWith(role) });
    const router = renderAt('/settings/attendance');
    await vi.waitFor(() => expect(router.state.location.pathname).not.toContain('/settings'));
  },
);

test.each(['owner', 'special_sales', 'sales'] as const)('%s opens Products', async (role) => {
  useSession.setState({ status: 'signedIn', user: userWith(role) });
  renderAt('/products');
  expect(await screen.findByLabelText('Search by name or SKU')).toBeInTheDocument();
});

test.each(['owner', 'special_sales'] as const)('%s opens Products > Categories', async (role) => {
  useSession.setState({ status: 'signedIn', user: userWith(role) });
  renderAt('/products/categories');
  expect(await screen.findByLabelText('New category')).toBeInTheDocument();
});

test.each(['/products/new', '/products/categories', '/products/suppliers'])(
  'Sales cannot open %s',
  async (path) => {
    useSession.setState({ status: 'signedIn', user: userWith('sales') });
    const router = renderAt(path);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
  },
);

test('the Owner opens Approvals; others cannot', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('owner') });
  renderAt('/approvals');
  expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
});

test.each(['special_sales', 'sales'] as const)('%s cannot open Approvals', async (role) => {
  useSession.setState({ status: 'signedIn', user: userWith(role) });
  const router = renderAt('/approvals');
  await vi.waitFor(() => expect(router.state.location.pathname).not.toBe('/approvals'));
});

test('Special Sales opens My requests; Sales cannot', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('special_sales') });
  renderAt('/requests');
  expect(await screen.findByRole('heading', { name: 'My requests' })).toBeInTheDocument();
});

test('Sales cannot open My requests', async () => {
  useSession.setState({ status: 'signedIn', user: userWith('sales') });
  const router = renderAt('/requests');
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sales'));
});
