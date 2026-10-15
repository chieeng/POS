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
