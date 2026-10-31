import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signOutUser } from '@/features/auth/authService';
import { useSession, type SessionUser } from '@/stores/session';
import { useBlocked } from '@/features/outbox/signOut';
import { SignOutBlockedDialog } from '@/features/outbox/SignOutBlockedDialog';
import { AppShell } from './AppShell';

vi.mock('@/lib/supabase', () => ({ env: { storeName: 'Test store' }, supabase: {} }));
vi.mock('@/features/auth/authService', () => ({ signOutUser: vi.fn() }));
vi.mock('@/features/approvals/data', () => ({
  useApprovalRequests: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('@/features/store/data', () => ({
  useBranch: () => ({ branch: null, loading: false, error: false }),
}));
const outbox = vi.hoisted(() => ({ waiting: 0, needsAttention: 0 }));
vi.mock('@/lib/outbox', () => ({
  countWaiting: () => Promise.resolve(outbox.waiting),
  watchOutbox: (_uid: string, onChange: (counts: typeof outbox) => void) => {
    onChange({ ...outbox });
    return () => undefined;
  },
}));

function signInAs(role: SessionUser['role']) {
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: 'u1',
      email: 'u@x.co',
      displayName: 'Maria Santos',
      role,
      branchId: 'main',
      secondFactor: role === 'owner',
    },
  });
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <AppShell />
            <SignOutBlockedDialog />
          </>
        ),
        children: [{ path: '*', element: <p>Page</p> }],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  outbox.waiting = 0;
  outbox.needsAttention = 0;
  useBlocked.setState({ count: 0 });
  // A phone: the bottom sheet, not the centered dialog.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe('phone account menu', () => {
  it.each(['owner', 'special_sales', 'sales'] as const)(
    '%s can sign out from any page through the avatar',
    async (role) => {
      signInAs(role);
      const user = renderAt('/products/p1');
      await user.click(screen.getByRole('button', { name: 'Account' }));
      const sheet = within(screen.getByRole('dialog', { name: 'Account' }));
      expect(sheet.getByText('Maria Santos')).toBeInTheDocument();
      await user.click(sheet.getByRole('button', { name: 'Sign out' }));
      expect(signOutUser).toHaveBeenCalledTimes(1);
    },
  );

  it('shows the role under the name', async () => {
    signInAs('special_sales');
    const user = renderAt('/stock-in');
    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Account' })).getByText('Special Sales'),
    ).toBeInTheDocument();
  });
});

describe('the outbox on every screen (NFR-02)', () => {
  it('blocks Sign out while sales have not been sent', async () => {
    outbox.waiting = 2;
    signInAs('sales');
    const user = renderAt('/products');
    expect(screen.getByText('2 to sync')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Account' })).getByRole('button', {
        name: 'Sign out',
      }),
    );
    expect(
      await screen.findByText("2 sales haven't been sent yet. Connect to the internet first."),
    ).toBeInTheDocument();
    expect(signOutUser).not.toHaveBeenCalled();
  });

  it('says when something made on this device could not be saved', () => {
    outbox.needsAttention = 1;
    signInAs('sales');
    renderAt('/products');
    expect(screen.getByRole('alert')).toHaveTextContent("1 sale on this device couldn't be saved");
  });
});
