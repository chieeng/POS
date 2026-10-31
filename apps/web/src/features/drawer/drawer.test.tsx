import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '@/stores/session';
import { parsePeso } from './data';
import { DrawerPage } from './DrawerPage';

type Json = Record<string, unknown>;

const server = vi.hoisted(() => ({
  today: {} as Json,
  expected: 2000 as number | null,
  failWith: null as string | null,
  calls: [] as { fn: string; args: Json | undefined }[],
}));

vi.mock('@/lib/device', () => ({ getDeviceTag: () => 'A1B2' }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Json) => {
      server.calls.push({ fn, args });
      if (fn === 'drawer_today') return Promise.resolve({ data: server.today, error: null });
      if (fn === 'drawer_expected_cash') {
        return Promise.resolve({ data: server.expected, error: null });
      }
      if (server.failWith) {
        return Promise.resolve({ data: null, error: { message: server.failWith } });
      }
      return Promise.resolve({ data: 'new-id', error: null });
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
      displayName: 'Jun Reyes',
      role,
      branchId: 'main',
      secondFactor: role === 'owner',
    },
  });
}

const OPEN_SESSION = {
  id: 'd1',
  business_date: '2026-11-01',
  status: 'open',
  opened_by_name: 'Maricel',
  opened_at: '2026-11-01T07:52:00+08:00',
  opening_cash: 1800,
};

function renderPage() {
  render(
    <MemoryRouter>
      <DrawerPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  server.calls = [];
  server.expected = 2000;
  server.failWith = null;
  server.today = { today: '2026-11-01', session: null, lastCount: null, staleOpen: false };
  signInAs('sales');
});

describe('opening the drawer (SHIFT-01)', () => {
  it('opens with the cash entered when there is no earlier count', async () => {
    const user = renderPage();
    expect(await screen.findByText('Sunday, Nov 1, 2026')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Opening cash'), '2,000');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(called('open_drawer')[0]?.args).toEqual({
      p_opening_cash: 2000,
      p_reason: null,
      p_device_tag: 'A1B2',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Today’s drawer is open.');
  });

  it('pre-fills yesterday’s count, and a different amount needs a reason', async () => {
    server.today.lastCount = {
      amount: 2000,
      counted_by_name: 'Maricel',
      closed_at: '2026-10-31T20:14:00+08:00',
      business_date: '2026-10-31',
    };
    const user = renderPage();
    const input = await screen.findByLabelText('Opening cash');
    expect(input).toHaveValue('2000.00');
    expect(
      screen.getByText('Yesterday’s closing count: ₱2,000.00 (Maricel, 8:14 PM)'),
    ).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '1800');
    expect(screen.getByRole('alert')).toHaveTextContent(
      '₱200.00 less than yesterday’s count. The Owner will see this on the drawer report.',
    );
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(screen.getByText('Say why the amount differs from the last count.')).toBeInTheDocument();
    expect(called('open_drawer')).toHaveLength(0);

    await user.type(screen.getByLabelText(/Reason/), 'Ice delivery before opening');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(called('open_drawer')[0]?.args).toMatchObject({
      p_opening_cash: 1800,
      p_reason: 'Ice delivery before opening',
    });
  });

  it('puts the amount back to the last count', async () => {
    server.today.lastCount = {
      amount: 2000,
      counted_by_name: 'Maricel',
      closed_at: '2026-10-29T20:14:00+08:00',
      business_date: '2026-10-29',
    };
    const user = renderPage();
    const input = await screen.findByLabelText('Opening cash');
    expect(screen.getByText(/Last \(Oct 29\) closing count/)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '2500');
    await user.click(screen.getByRole('button', { name: 'Reset to ₱2,000.00' }));
    expect(input).toHaveValue('2000.00');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says an earlier drawer was never counted', async () => {
    server.today.staleOpen = true;
    renderPage();
    expect(await screen.findByText(/An earlier drawer was never counted/)).toBeInTheDocument();
  });

  it('explains when someone else opened it first', async () => {
    server.failWith = 'already_open';
    const user = renderPage();
    await user.type(await screen.findByLabelText('Opening cash'), '2000');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(await screen.findByText('Someone already opened today’s drawer.')).toBeInTheDocument();
  });
});

describe('cash in and out (SHIFT-02)', () => {
  beforeEach(() => {
    server.today.session = OPEN_SESSION;
  });

  it('shows the open drawer, and records a cash-out with a reason', async () => {
    const user = renderPage();
    expect(
      await screen.findByText(/since 7:52 AM, by Maricel, with ₱1,800.00/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cash out' }));
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByLabelText('Amount'), '350');
    await user.click(sheet.getByRole('button', { name: 'Record cash out' }));
    expect(sheet.getByText('Choose a reason.')).toBeInTheDocument();

    await user.click(sheet.getByRole('radio', { name: 'Other' }));
    await user.click(sheet.getByRole('button', { name: 'Record cash out' }));
    expect(sheet.getByText('Add a note: what was it for?')).toBeInTheDocument();

    await user.click(sheet.getByRole('radio', { name: 'Expense' }));
    await user.type(sheet.getByLabelText(/Note/), 'Ice, 2 sacks');
    await user.click(sheet.getByRole('button', { name: 'Record cash out' }));
    expect(called('record_drawer_entry')[0]?.args).toEqual({
      p_type: 'cash_out',
      p_amount: 350,
      p_reason: 'expense',
      p_note: 'Ice, 2 sacks',
      p_device_tag: 'A1B2',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Cash out of ₱350.00 recorded.');
  });

  it('offers only change fund or other for cash coming in', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Cash in' }));
    const reasons = within(
      within(screen.getByRole('dialog')).getByRole('radiogroup', { name: 'Reason' }),
    );
    expect(reasons.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'change_fund',
      'other',
    ]);
  });

  it('never asks the server for expected cash for staff (blind count)', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Cash out' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Amount'), '350');
    expect(called('drawer_expected_cash')).toHaveLength(0);
    expect(screen.queryByText(/Expected cash/)).toBeNull();
  });

  it('shows the Owner the expected cash after the entry', async () => {
    signInAs('owner');
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Cash out' }));
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByLabelText('Amount'), '350');
    expect(await sheet.findByText('Expected cash after: ₱1,650.00')).toBeInTheDocument();
  });
});

describe('a closed drawer', () => {
  it('says later sales go to tomorrow’s drawer', async () => {
    server.today.session = { ...OPEN_SESSION, status: 'closed' };
    renderPage();
    expect(await screen.findByText(/Today’s drawer is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cash out' })).toBeNull();
  });
});

describe('parsePeso', () => {
  it('reads amounts as people type them', () => {
    expect(parsePeso('1,800.50')).toBe(1800.5);
    expect(parsePeso('₱ 350')).toBe(350);
    expect(parsePeso('12.345')).toBeNull();
    expect(parsePeso('abc')).toBeNull();
    expect(parsePeso('')).toBeNull();
  });
});

describe('the Owner’s drawer report link', () => {
  it('shows for the Owner only', async () => {
    signInAs('owner');
    renderPage();
    expect(await screen.findByRole('link', { name: 'Drawer report' })).toBeInTheDocument();
  });

  it('is not there for staff', async () => {
    renderPage();
    await screen.findByLabelText('Opening cash');
    expect(screen.queryByRole('link', { name: 'Drawer report' })).toBeNull();
  });
});
