import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { useSession, type SessionUser } from '@/stores/session';
import { confirmPassword, signOutUser } from './authService';
import { IdleLock } from './IdleLock';
import { isIdleExpired, readLocked, writeLocked } from './idleStorage';

vi.mock('@/lib/firebase', () => ({ env: {} }));
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
  vi.mocked(confirmPassword).mockRejectedValue({ code: 'auth/invalid-credential' });
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
  expect(readLocked()).toBe(false);
});

test('"Sign in as someone else" signs out', async () => {
  render(<IdleLock user={owner} minutes={15} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in as someone else' }));
  expect(signOutUser).toHaveBeenCalled();
});

test('isIdleExpired compares against the idle limit', () => {
  const now = 1_000_000_000;
  expect(isIdleExpired(null, now, 15)).toBe(false);
  expect(isIdleExpired(now - 14 * 60_000, now, 15)).toBe(false);
  expect(isIdleExpired(now - 15 * 60_000, now, 15)).toBe(true);
});
