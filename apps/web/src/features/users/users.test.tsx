import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import { api } from '@/lib/api';
import { useSession } from '@/stores/session';
import { AddUserPage } from './AddUserPage';
import {
  describeLastSeen,
  latestSeen,
  sortUsers,
  type AuditRecord,
  type DeviceRecord,
  type UserRecord,
} from './data';
import { UserDetailPage } from './UserDetailPage';

const USERS: UserRecord[] = [
  {
    uid: 'o1',
    displayName: 'Rosario Santos',
    email: 'r@x.co',
    role: 'owner',
    userCode: 'RS',
    active: true,
  },
  {
    uid: 's1',
    displayName: 'Jun Reyes',
    email: 'jun@x.co',
    role: 'sales',
    userCode: 'JR',
    active: true,
  },
  {
    uid: 's2',
    displayName: 'Ricky Flores',
    email: 'ricky@x.co',
    role: 'sales',
    userCode: 'RF',
    active: false,
  },
];
const DEVICES: DeviceRecord[] = [
  { uid: 's1', deviceTag: 'A1B2', label: 'Android phone · Chrome', lastSeenAt: new Date() },
];

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('@/lib/api', () => ({
  api: {
    createUser: vi.fn(),
    updateUser: vi.fn(),
    setUserRole: vi.fn(),
    deactivateUser: vi.fn(),
    signOutEverywhere: vi.fn(),
    createPasswordResetLink: vi.fn(),
  },
  describeApiError: (error: unknown) => (error instanceof Error ? error.message : 'Failed'),
}));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useUsers: () => ({ data: USERS, loading: false, error: false }),
  useDevices: () => ({ data: DEVICES, loading: false, error: false }),
}));

const mocked = vi.mocked(api);

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/settings/users', element: <p>users list</p> },
      { path: '/settings/users/new', element: <AddUserPage /> },
      { path: '/settings/users/:uid', element: <UserDetailPage /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: 'o1',
      email: 'r@x.co',
      displayName: 'Rosario Santos',
      role: 'owner',
      branchId: 'main',
      secondFactor: true,
    },
  });
});

describe('AddUserPage (AUTH-02, SEC-01)', () => {
  test('validates, creates the user and shows the one-time link', async () => {
    mocked.createUser.mockResolvedValue({
      uid: 'n1',
      resetLink: 'https://example.test/reset?oobCode=abc',
    });
    const user = renderAt('/settings/users/new');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    expect(mocked.createUser).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Full name'), 'Maricel Dizon');
    await user.type(screen.getByLabelText('Email'), 'maricel@example.com');
    expect(screen.getByLabelText('User code')).toHaveValue('MD');
    await user.click(screen.getByRole('radio', { name: 'Special Sales' }));
    await user.click(screen.getByRole('button', { name: 'Add user' }));

    expect(mocked.createUser).toHaveBeenCalledWith({
      displayName: 'Maricel Dizon',
      email: 'maricel@example.com',
      role: 'special_sales',
      userCode: 'MD',
    });
    expect(await screen.findByText('https://example.test/reset?oobCode=abc')).toBeInTheDocument();
  });

  test('has no password field and offers staff roles only', () => {
    renderAt('/settings/users/new');
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.getAllByRole('radio').map((radio) => radio.parentElement?.textContent)).toEqual([
      'Sales',
      'Special Sales',
    ]);
  });

  test('shows the server error', async () => {
    mocked.createUser.mockRejectedValue(new Error('This user code is already taken.'));
    const user = renderAt('/settings/users/new');
    await user.type(screen.getByLabelText('Full name'), 'Jun Reyes');
    await user.type(screen.getByLabelText('Email'), 'jun2@example.com');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already taken');
  });
});

describe('UserDetailPage', () => {
  test('changes the role after confirmation (AUTH-03)', async () => {
    mocked.setUserRole.mockResolvedValue({ uid: 's1', role: 'special_sales' });
    const user = renderAt('/settings/users/s1');
    await user.click(screen.getByRole('radio', { name: 'Special Sales' }));
    expect(mocked.setUserRole).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Change role' }),
    );
    expect(mocked.setUserRole).toHaveBeenCalledWith({ uid: 's1', role: 'special_sales' });
  });

  test('deactivates with a reason after confirmation (SEC-04)', async () => {
    mocked.deactivateUser.mockResolvedValue({ uid: 's1' });
    const user = renderAt('/settings/users/s1');
    await user.click(screen.getByRole('button', { name: 'Deactivate Jun' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Reason (optional)'), 'Left the store');
    await user.click(dialog.getByRole('button', { name: 'Deactivate' }));
    expect(mocked.deactivateUser).toHaveBeenCalledWith({ uid: 's1', reason: 'Left the store' });
  });

  test('signs out of all devices and shows the device list (AUTH-04, SYS-02)', async () => {
    mocked.signOutEverywhere.mockResolvedValue({ uid: 's1' });
    const user = renderAt('/settings/users/s1');
    expect(screen.getByText('Android phone · Chrome')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out of all devices' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }));
    expect(mocked.signOutEverywhere).toHaveBeenCalledWith({ uid: 's1' });
  });

  test('saves an edited name and code (AUTH-02)', async () => {
    mocked.updateUser.mockResolvedValue({ uid: 's1' });
    const user = renderAt('/settings/users/s1');
    const name = screen.getByLabelText('Full name');
    await user.clear(name);
    await user.type(name, 'Jun R. Reyes');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocked.updateUser).toHaveBeenCalledWith({
      uid: 's1',
      displayName: 'Jun R. Reyes',
      userCode: 'JR',
    });
  });

  test('the Owner cannot change their own role or deactivate themselves', () => {
    renderAt('/settings/users/o1');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: /Deactivate/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out of all devices' })).toBeInTheDocument();
  });

  test('a deactivated user has no actions', () => {
    renderAt('/settings/users/s2');
    expect(screen.getByText(/turned off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deactivate|Sign out|reset/i })).toBeNull();
  });

  test('an unknown user id shows a message', () => {
    renderAt('/settings/users/nope');
    expect(screen.getByRole('alert')).toHaveTextContent('not found');
  });
});

describe('helpers', () => {
  const now = new Date('2026-10-09T12:00:00');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  test('describeLastSeen', () => {
    expect(describeLastSeen(null, { now })).toBe('Never');
    expect(describeLastSeen(ago(2), { now })).toBe('Active now');
    expect(describeLastSeen(ago(12), { now })).toBe('12 min ago');
    expect(describeLastSeen(ago(130), { now })).toBe('2 hr ago');
    expect(describeLastSeen(ago(30 * 60), { now })).toBe('Yesterday');
    expect(describeLastSeen(new Date('2026-08-30T09:00:00'), { now })).toBe('Aug 30');
  });

  test('a deactivated user is never "Active now"', () => {
    expect(describeLastSeen(ago(2), { now, active: false })).toBe('2 min ago');
    expect(describeLastSeen(ago(0), { now, active: false })).toBe('1 min ago');
    expect(describeLastSeen(ago(12), { now, active: false })).toBe('12 min ago');
  });

  test('latestSeen picks the most recent device', () => {
    const device = (lastSeenAt: Date | null): DeviceRecord => ({
      uid: 'u',
      deviceTag: 'T',
      label: '',
      lastSeenAt,
    });
    expect(latestSeen([device(ago(50)), device(null), device(ago(5))])).toEqual(ago(5));
    expect(latestSeen([])).toBeNull();
  });

  test('sortUsers puts active users first, the Owner on top', () => {
    expect(sortUsers([USERS[2]!, USERS[1]!, USERS[0]!]).map((user) => user.uid)).toEqual([
      'o1',
      's1',
      's2',
    ]);
  });

  test('describeAudit reads as a sentence', () => {
    const entry = (overrides: Partial<AuditRecord>): AuditRecord => ({
      id: '1',
      action: '',
      actorId: 'o1',
      targetId: 's1',
      deviceTag: null,
      before: null,
      after: null,
      reason: null,
      createdAt: null,
      ...overrides,
    });
    expect(
      describeAudit(
        entry({
          action: 'user.setRole',
          before: { role: 'sales' },
          after: { role: 'special_sales' },
        }),
        'Jun Reyes',
      ),
    ).toMatchObject({ what: 'changed the role of Jun Reyes', change: 'Sales → Special Sales' });
    expect(
      describeAudit(
        entry({ action: 'user.update', before: { userCode: 'JR' }, after: { userCode: 'JRR' } }),
        'Jun Reyes',
      ).change,
    ).toBe('Code: JR → JRR');
    expect(
      describeAudit(entry({ action: 'user.deactivate', reason: 'Left' }), 'Jun Reyes').change,
    ).toBe('Left');
    expect(describeAudit(entry({ action: 'auth.passwordSet' }), 'x').what).toBe(
      'set their password',
    );
    expect(describeAudit(entry({ action: 'auth.twoStepOn' }), 'x').what).toBe(
      'turned on two-step sign-in',
    );
    expect(describeAudit(entry({ action: 'something.new' }), 'x').what).toBe('something.new');
  });
});
