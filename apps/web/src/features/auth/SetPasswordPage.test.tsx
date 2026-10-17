import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { useSession, type SessionUser } from '@/stores/session';
import { pendingSecondStep, redeemPasswordLink, setNewPassword, signOutUser } from './authService';
import { checkPwnedPassword } from './pwnedPasswords';
import { SetPasswordPage } from './SetPasswordPage';

const link = vi.hoisted(() => ({ failed: false, token: null as string | null }));

vi.mock('@/lib/supabase', () => ({
  env: {},
  get passwordLinkFailed() {
    return link.failed;
  },
  get passwordLinkToken() {
    return link.token;
  },
}));
vi.mock('./pwnedPasswords', () => ({ checkPwnedPassword: vi.fn() }));
vi.mock('./authService', () => ({
  pendingSecondStep: vi.fn(),
  redeemPasswordLink: vi.fn(),
  setNewPassword: vi.fn(),
  signOutUser: vi.fn(),
  verifyTotp: vi.fn(),
}));

const sales: SessionUser = {
  uid: 'u1',
  email: 'jun@example.com',
  displayName: 'Jun Reyes',
  role: 'sales',
  branchId: 'main',
  secondFactor: false,
};

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/set-password', element: <SetPasswordPage /> },
      { path: '/sign-in', element: <p>sign-in screen</p> },
      { path: '/', element: <p>home</p> },
    ],
    { initialEntries: ['/set-password'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  link.failed = false;
  link.token = null;
  vi.mocked(pendingSecondStep).mockResolvedValue(null);
  vi.mocked(checkPwnedPassword).mockResolvedValue('not-found');
  useSession.setState({ status: 'signedIn', user: sales, passwordSetup: true, locked: false });
});

test('someone who opened a one-time link chooses their own password (AUTH-02)', async () => {
  vi.mocked(setNewPassword).mockResolvedValue();
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Choose your password' })).toBeInTheDocument();
  expect(screen.getByText('jun@example.com')).toBeInTheDocument();

  const user = userEvent.setup();
  await user.type(screen.getByLabelText('New password'), 'long-enough-1');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(setNewPassword).toHaveBeenCalledWith('long-enough-1');
});

test('a password known from a data breach is refused before it is sent (SEC-05)', async () => {
  vi.mocked(checkPwnedPassword).mockResolvedValue('breached');
  renderPage();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('New password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(
    await screen.findByText('This password has appeared in a data breach.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Choose another.')).toBeInTheDocument();
  expect(checkPwnedPassword).toHaveBeenCalledWith('password123');
  expect(setNewPassword).not.toHaveBeenCalled();
});

test('if the breach check cannot run, the password is still saved', async () => {
  vi.mocked(checkPwnedPassword).mockResolvedValue('unknown');
  vi.mocked(setNewPassword).mockResolvedValue();
  renderPage();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('New password'), 'long-enough-1');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(setNewPassword).toHaveBeenCalledWith('long-enough-1');
});

test('a password shorter than 10 characters is rejected before it is sent (SEC-05)', async () => {
  renderPage();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('New password'), 'short123');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();
  expect(setNewPassword).not.toHaveBeenCalled();
});

test('a password the server finds too weak is explained', async () => {
  vi.mocked(setNewPassword).mockRejectedValue({ code: 'weak_password' });
  renderPage();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('New password'), 'password1234');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByText('That password is too easy to guess.')).toBeInTheDocument();
});

test('an account with an authenticator app enters its code first', async () => {
  vi.mocked(pendingSecondStep).mockResolvedValue({ factorId: 'f1' });
  useSession.setState({ user: { ...sales, role: 'owner' } });
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
  expect(screen.queryByLabelText('New password')).toBeNull();
});

test('the screen is only for people who came from a link', async () => {
  useSession.setState({ passwordSetup: false });
  const router = renderPage();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('a signed-out visitor is sent to sign-in', async () => {
  useSession.setState({ status: 'signedOut', user: null, passwordSetup: false });
  const router = renderPage();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
});

test('an expired or used link says so', () => {
  link.failed = true;
  useSession.setState({ status: 'signedOut', user: null, passwordSetup: false });
  renderPage();
  expect(screen.getByRole('heading', { name: 'This link no longer works' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Ask the Owner to make a new one.');
});

test('"Sign out" leaves without changing the password', async () => {
  renderPage();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out' }));
  expect(signOutUser).toHaveBeenCalled();
  expect(setNewPassword).not.toHaveBeenCalled();
});

test('opening a link uses nothing until Continue is pressed', async () => {
  link.token = 'hashed-token';
  vi.mocked(redeemPasswordLink).mockResolvedValue();
  useSession.setState({ status: 'signedOut', user: null, passwordSetup: false });
  renderPage();
  expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
  expect(redeemPasswordLink).not.toHaveBeenCalled();

  await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
  expect(redeemPasswordLink).toHaveBeenCalledWith('hashed-token');
});

test('after Continue, the password form appears once the sign-in arrives', async () => {
  link.token = 'hashed-token';
  vi.mocked(redeemPasswordLink).mockImplementation(async () => {
    useSession.setState({ status: 'signedIn', user: sales, passwordSetup: true });
  });
  useSession.setState({ status: 'signedOut', user: null, passwordSetup: false });
  renderPage();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByLabelText('New password')).toBeInTheDocument();
});

test('a link that was already used or replaced says so after Continue', async () => {
  link.token = 'hashed-token';
  vi.mocked(redeemPasswordLink).mockRejectedValue({ code: 'otp_expired' });
  useSession.setState({ status: 'signedOut', user: null, passwordSetup: false });
  renderPage();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
  expect(
    await screen.findByRole('heading', { name: 'This link no longer works' }),
  ).toBeInTheDocument();
});
