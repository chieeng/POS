import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '@/stores/session';
import { CountDrawerPage } from './CountDrawerPage';
import { DrawerPage } from './DrawerPage';

type Json = Record<string, unknown>;

const server = vi.hoisted(() => ({
  today: {} as Json,
  close: { expected: 2150, counted: 2140, overShort: -10 } as Json,
  failWith: null as string | null,
  calls: [] as { fn: string; args: Json | undefined }[],
}));

vi.mock('@/lib/device', () => ({ getDeviceTag: () => 'C3D4' }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Json) => {
      server.calls.push({ fn, args });
      if (fn === 'drawer_today') return Promise.resolve({ data: server.today, error: null });
      if (server.failWith) {
        return Promise.resolve({ data: null, error: { message: server.failWith } });
      }
      if (fn === 'close_drawer') return Promise.resolve({ data: server.close, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

const called = (fn: string) => server.calls.filter((call) => call.fn === fn);

function signInAs(role: SessionUser['role']) {
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: 'u1',
      email: 'u@x.co',
      displayName: 'Liza Mendoza',
      role,
      branchId: 'main',
      secondFactor: role === 'owner',
    },
  });
}

function renderAt(page: React.ReactNode) {
  render(<MemoryRouter>{page}</MemoryRouter>);
  return userEvent.setup();
}

beforeEach(() => {
  server.calls = [];
  server.failWith = null;
  server.close = { expected: 2150, counted: 2140, overShort: -10 };
  server.today = {
    today: '2026-11-01',
    session: {
      id: 'd1',
      business_date: '2026-11-01',
      status: 'open',
      opened_by_name: 'Jun Reyes',
      opened_at: '2026-11-01T07:52:00+08:00',
      opening_cash: 2000,
    },
    lastCount: null,
    staleOpen: false,
  };
  signInAs('special_sales');
});

describe('who counts the drawer (SHIFT-03)', () => {
  it('offers Count and close to Special Sales and the Owner, not to Sales', async () => {
    renderAt(<DrawerPage />);
    expect(await screen.findByRole('link', { name: 'Count and close' })).toHaveAttribute(
      'href',
      '/count',
    );
  });

  it('hides it from Sales', async () => {
    signInAs('sales');
    renderAt(<DrawerPage />);
    await screen.findByText(/since 7:52 AM/);
    expect(screen.queryByRole('link', { name: 'Count and close' })).toBeNull();
  });
});

describe('counting by denomination, blind (SHIFT-03)', () => {
  it('adds up the bills and coins, and shows no expected cash before closing', async () => {
    const user = renderAt(<CountDrawerPage />);
    const thousands = await screen.findByRole('spinbutton', { name: 'Number of ₱1,000' });
    await user.click(screen.getByRole('button', { name: 'More number of ₱1,000' }));
    await user.click(screen.getByRole('button', { name: 'More number of ₱1,000' }));
    expect(thousands).toHaveValue('2');
    const twenties = screen.getByRole('spinbutton', { name: 'Number of ₱20' });
    await user.clear(twenties);
    await user.type(twenties, '2');
    await user.type(screen.getByRole('spinbutton', { name: 'Number of ₱100' }), '1');

    expect(screen.getByText('₱2,140.00')).toBeInTheDocument();
    expect(screen.queryByText(/2,150/)).toBeNull();
    expect(screen.queryByText(/Short|Over/)).toBeNull();
    expect(called('drawer_expected_cash')).toHaveLength(0);
  });

  it('asks first, then closes with every count and reveals the exact difference', async () => {
    const user = renderAt(<CountDrawerPage />);
    await user.type(await screen.findByRole('spinbutton', { name: 'Number of ₱1,000' }), '2');
    await user.type(screen.getByRole('spinbutton', { name: 'Number of ₱100' }), '1');
    await user.type(screen.getByRole('spinbutton', { name: 'Number of ₱20' }), '2');
    await user.type(screen.getByLabelText('Note for the Owner (optional)'), 'Counted twice');
    await user.click(screen.getByRole('button', { name: 'Close drawer' }));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Close today’s drawer with ₱2,140.00 counted?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Close drawer' }));

    expect(called('close_drawer')[0]?.args).toEqual({
      p_counts: { 1000: 2, 500: 0, 200: 0, 100: 1, 50: 0, 20: 2, 10: 0, 5: 0, 1: 0 },
      p_note: 'Counted twice',
      p_device_tag: 'C3D4',
    });
    expect(await screen.findByText('The drawer is closed.')).toBeInTheDocument();
    expect(screen.getByText('₱2,150.00')).toBeInTheDocument();
    expect(screen.getByText('Short')).toBeInTheDocument();
    expect(screen.getByText('−₱10.00')).toBeInTheDocument();
  });

  it('says Exact when the count matches', async () => {
    server.close = { expected: 2000, counted: 2000, overShort: 0 };
    const user = renderAt(<CountDrawerPage />);
    await user.type(await screen.findByRole('spinbutton', { name: 'Number of ₱1,000' }), '2');
    await user.click(screen.getByRole('button', { name: 'Close drawer' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close drawer' }),
    );
    expect(await screen.findByText('Exact')).toBeInTheDocument();
  });

  it('explains when someone else closed it first', async () => {
    server.failWith = 'drawer_not_open';
    const user = renderAt(<CountDrawerPage />);
    await user.click(await screen.findByRole('button', { name: 'Close drawer' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close drawer' }),
    );
    expect(
      await screen.findByText('No drawer is open any more: someone may have closed it already.'),
    ).toBeInTheDocument();
  });

  it('has nothing to count when no drawer is open', async () => {
    server.today = { ...server.today, session: null };
    renderAt(<CountDrawerPage />);
    expect(await screen.findByText(/There is no open drawer to count/)).toBeInTheDocument();
  });
});
