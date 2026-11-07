import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { useSession, type SessionUser } from '@/stores/session';
import { confirmPassword, signOutUser } from './authService';
import { IdleLock } from './IdleLock';
import { isIdleExpired, readLocked, writeLocked } from './idleStorage';
import { rememberPassword } from './offlineUnlock';

vi.mock('@/lib/supabase', () => ({ env: {} }));
vi.mock('./authService', () => ({ confirmPassword: vi.fn(), signOutUser: vi.fn() }));

const owner: SessionUser = {
  uid: 'u1',
  email: 'rosario@example.com',
  displayName: 'Rosario Santos',
  role: 'owner',
  branchId: 'main',
  secondFactor: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
  writeLocked(true);
  useSession.setState({ status: 'signedIn', user: owner, locked: true });
});

test('shows who is locked and for how long', () => {
  render(<IdleLock user={owner} minutes={15} />);
  expect(screen.getByRole('heading', { name: 'Locked after 15 minutes idle' })).toBeInTheDocument();
  expect(screen.getByText('Rosario Santos · Owner')).toBeInTheDocument();
  expect(screen.getByText('RS')).toBeInTheDocument();
});

test('stays locked on a wrong password', async () => {
  vi.mocked(confirmPassword).mockRejectedValue({ code: 'invalid_credentials' });
  render(<IdleLock user={owner} minutes={15} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Password'), 'nope{Enter}');
  expect(await screen.findByText('That password is wrong.')).toBeInTheDocument();
  expect(useSession.getState().locked).toBe(true);
  expect(readLocked()).toBe(true);
});

test('unlocks on the right password', async () => {
  vi.mocked(confirmPassword).mockResolvedValue();
  render(<IdleLock user={owner} minutes={15} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Password'), 'password12{Enter}');
  await vi.waitFor(() => expect(useSession.getState().locked).toBe(false));
  expect(confirmPassword).toHaveBeenCalledWith('password12', 'test-captcha-token');
  expect(readLocked()).toBe(false);
});

test('"Sign in as someone else" signs out', async () => {
  render(<IdleLock user={owner} minutes={15} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in as someone else' }));
  expect(signOutUser).toHaveBeenCalled();
});

function goOffline() {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
}

test('offline: unlocks with the password checked on this device', async () => {
  await rememberPassword('u1', 'password12', 1_000);
  goOffline();
  render(<IdleLock user={owner} minutes={15} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Password'), 'password12{Enter}');
  await vi.waitFor(() => expect(useSession.getState().locked).toBe(false));
  expect(confirmPassword).not.toHaveBeenCalled();
});

test('offline: a wrong password says how many tries are left', async () => {
  await rememberPassword('u1', 'password12', 1_000);
  goOffline();
  render(<IdleLock user={owner} minutes={15} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Password'), 'nope{Enter}');
  expect(await screen.findByText('That password is wrong.')).toBeInTheDocument();
  expect(
    screen.getByText('4 tries left before this device needs the internet to unlock.'),
  ).toBeInTheDocument();
  expect(useSession.getState().locked).toBe(true);
});

test('offline with no saved check: asks for the internet', () => {
  goOffline();
  render(<IdleLock user={owner} minutes={15} />);
  expect(screen.getByText('Connect to the internet to unlock.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Unlock/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Sign in as someone else' })).toBeEnabled();
});

test('online but the server cannot be reached: falls back to the device check', async () => {
  await rememberPassword('u1', 'password12', 1_000);
  vi.mocked(confirmPassword).mockRejectedValue(new TypeError('Failed to fetch'));
  render(<IdleLock user={owner} minutes={15} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Password'), 'password12{Enter}');
  await vi.waitFor(() => expect(useSession.getState().locked).toBe(false));
});

test('isIdleExpired compares against the idle limit', () => {
  const now = 1_000_000_000;
  expect(isIdleExpired(null, now, 15)).toBe(false);
  expect(isIdleExpired(now - 14 * 60_000, now, 15)).toBe(false);
  expect(isIdleExpired(now - 15 * 60_000, now, 15)).toBe(true);
});
