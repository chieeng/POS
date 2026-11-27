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
  offline: false,
  /** The last real count, as open_drawer compares with it (never sent before the count). */
  lastCount: null as Json | null,
  calls: [] as { fn: string; args: Json | undefined }[],
}));

vi.mock('@/lib/device', () => ({ getDeviceTag: () => 'A1B2' }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Json) => {
      server.calls.push({ fn, args });
      if (fn === 'drawer_today') {
        return Promise.resolve(
          server.offline
            ? { data: null, error: { message: 'Failed to fetch' } }
            : { data: server.today, error: null },
        );
      }
      if (fn === 'drawer_expected_cash') {
        return Promise.resolve({ data: server.expected, error: null });
      }
      if (server.failWith) {
        return Promise.resolve({ data: null, error: { message: server.failWith } });
      }
      if (fn === 'open_drawer' && server.lastCount && !args?.p_reason) {
        const counted = Object.entries(args?.p_counts as Record<string, number>).reduce(
          (sum, [bill, count]) => sum + Number(bill) * count,
          0,
        );
        const last = Number(server.lastCount.amount);
        if (counted !== last) {
          const details = JSON.stringify({
            counted,
            lastCount: server.lastCount,
            difference: counted - last,
          });
          return Promise.resolve({ data: null, error: { message: 'reason_required', details } });
        }
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
  server.offline = false;
  server.lastCount = null;
  server.today = { today: '2026-11-01', session: null, staleOpen: false };
  signInAs('sales');
});

describe('opening the drawer (SHIFT-01)', () => {
  it('says the drawer needs internet when it can’t load, without calling it closed', async () => {
    server.offline = true;
    renderPage();
    expect(await screen.findByText('The drawer needs internet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cash drawer');
    expect(screen.queryByText(/Open today/)).toBeNull();
  });

  it('starts empty and opens with the count by denomination when there is no earlier count', async () => {
    const user = renderPage();
    expect(await screen.findByText('Sunday, Nov 1, 2026')).toBeInTheDocument();
    expect(screen.getByLabelText('Opening cash')).toHaveTextContent('₱0.00');
    await user.type(screen.getByRole('spinbutton', { name: 'Number of ₱1,000' }), '2');
    expect(screen.getByLabelText('Opening cash')).toHaveTextContent('₱2,000.00');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(called('open_drawer')[0]?.args).toEqual({
      p_counts: {
        '1000': 2,
        '500': 0,
        '200': 0,
        '100': 0,
        '50': 0,
        '20': 0,
        '10': 0,
        '5': 0,
        '1': 0,
      },
      p_reason: null,
      p_device_tag: 'A1B2',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Today’s drawer is open.');
  });

  it('is blind: nothing about the last count shows before the count, the Owner included', async () => {
    signInAs('owner');
    server.lastCount = {
      amount: 2000,
      counted_by_name: 'Maricel',
      closed_at: '2026-10-31T20:14:00+08:00',
      business_date: '2026-10-31',
      before_reopen: false,
    };
    renderPage();
    expect(await screen.findByLabelText('Opening cash')).toHaveTextContent('₱0.00');
    expect(screen.queryByText(/Maricel|2,000|closing count/)).toBeNull();
  });

  it('after the count, a difference from yesterday’s count shows and needs a reason', async () => {
    server.lastCount = {
      amount: 2000,
      counted_by_name: 'Maricel',
      closed_at: '2026-10-31T20:14:00+08:00',
      business_date: '2026-10-31',
      before_reopen: false,
    };
    const user = renderPage();
    await user.type(await screen.findByRole('spinbutton', { name: 'Number of ₱1,000' }), '1');
    await user.type(screen.getByRole('spinbutton', { name: 'Number of ₱500' }), '1');
    await user.type(screen.getByRole('spinbutton', { name: 'Number of ₱100' }), '3');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '₱200.00 less than yesterday’s closing count (₱2,000.00, Maricel, 8:14 PM). Count again, or say why. The Owner will see this on the drawer report.',
    );
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(screen.getByText('Say why the count differs from the last count.')).toBeInTheDocument();
    expect(called('open_drawer')).toHaveLength(1);

    await user.type(screen.getByLabelText(/Reason/), 'Ice delivery before opening');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(called('open_drawer')[1]?.args).toMatchObject({
      p_counts: { '1000': 1, '500': 1, '100': 3 },
      p_reason: 'Ice delivery before opening',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Today’s drawer is open.');
  });

  it('a new count after the difference is checked again, without the old warning', async () => {
    server.lastCount = {
      amount: 2000,
      counted_by_name: 'Maricel',
      closed_at: '2026-10-31T20:14:00+08:00',
      business_date: '2026-10-31',
      before_reopen: false,
    };
    const user = renderPage();
    const thousands = await screen.findByRole('spinbutton', { name: 'Number of ₱1,000' });
    await user.type(thousands, '1');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(await screen.findByText(/₱1,000.00 less than/)).toBeInTheDocument();
    await user.clear(thousands);
    await user.type(thousands, '2');
    expect(screen.queryByText(/less than/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(called('open_drawer')[1]?.args).toMatchObject({ p_reason: null });
    expect(await screen.findByRole('status')).toHaveTextContent('Today’s drawer is open.');
  });

  it('says when it was compared with the count taken before a reopen', async () => {
    server.lastCount = {
      amount: 1140,
      counted_by_name: 'Test Special 5',
      closed_at: '2026-10-31T19:33:00+08:00',
      business_date: '2026-10-31',
      before_reopen: true,
    };
    const user = renderPage();
    await user.type(await screen.findByRole('spinbutton', { name: 'Number of ₱1,000' }), '1');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(
      await screen.findByText(
        '₱140.00 less than the count taken before the drawer was reopened (₱1,140.00, Test Special 5, Oct 31 7:33 PM).',
      ),
    ).toBeInTheDocument();
  });

  it('says when it was compared with a drawer counted later (overnight count)', async () => {
    server.lastCount = {
      amount: 1648,
      counted_by_name: 'Test Special 5',
      closed_at: '2026-11-01T07:05:00+08:00',
      business_date: '2026-10-31',
      before_reopen: false,
    };
    const user = renderPage();
    await user.type(await screen.findByRole('spinbutton', { name: 'Number of ₱1,000' }), '1');
    await user.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(
      await screen.findByText(
        '₱648.00 less than Oct 31’s count (₱1,648.00, counted later, today 7:05 AM, by Test Special 5).',
      ),
    ).toBeInTheDocument();
  });

  it('says an earlier drawer was never counted', async () => {
    server.today.staleOpen = true;
    renderPage();
    expect(await screen.findByText(/An earlier drawer was never counted/)).toBeInTheDocument();
  });

  it('explains when someone else opened it first', async () => {
    server.failWith = 'already_open';
    const user = renderPage();
    await user.type(await screen.findByRole('spinbutton', { name: 'Number of ₱1,000' }), '2');
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
