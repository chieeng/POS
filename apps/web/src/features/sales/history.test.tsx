import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxItem } from '@/lib/outbox';
import { useSession, type SessionUser } from '@/stores/session';
import { dayHeading, daysBefore, manilaDay, rangeFor } from './history';
import { SaleDetailPage } from './SaleDetailPage';
import { SalesHistoryPage } from './SalesHistoryPage';

type Json = Record<string, unknown>;

const server = vi.hoisted(() => ({
  history: [] as Json[],
  historyError: false,
  detail: null as Json | null,
  detailError: null as string | null,
  calls: [] as { fn: string; args: Json }[],
  outbox: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Json) => {
      server.calls.push({ fn, args });
      if (fn === 'sales_history') {
        if (server.historyError) {
          return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
        }
        const page = server.history.shift() ?? { sales: [], days: [], hasMore: false };
        return Promise.resolve({ data: page, error: null });
      }
      if (fn === 'sale_detail') {
        return Promise.resolve(
          server.detailError
            ? { data: null, error: { message: server.detailError } }
            : { data: server.detail, error: null },
        );
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));
vi.mock('@/lib/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/outbox')>()),
  watchOutboxSales: (_uid: string, onChange: (items: unknown[]) => void) => {
    onChange(server.outbox);
    return () => undefined;
  },
}));
vi.mock('@/features/users/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/users/data')>()),
  useUsers: () => ({
    data: [
      {
        uid: 'u2',
        displayName: 'Test Two',
        email: '',
        role: 'sales',
        userCode: 'TT',
        active: true,
      },
      {
        uid: 'u5',
        displayName: 'Test Special 5',
        email: '',
        role: 'special_sales',
        userCode: 'S5',
        active: true,
      },
    ],
    loading: false,
    error: false,
  }),
}));

const today = manilaDay(new Date());
const noon = (day: string, hour = 12) => `${day}T${String(hour).padStart(2, '0')}:00:00+08:00`;

const sale = (n: number, day: string, total: number, extra: Json = {}): Json => ({
  id: `s${n}`,
  receiptNo: `TT-20261114-KY96-${n}`,
  madeAt: noon(day, 8 + n),
  salesperson: 'Test Two',
  total,
  items: 3,
  methods: ['cash'],
  status: 'completed',
  flags: [],
  madeOffline: false,
  ...extra,
});

function signInAs(role: SessionUser['role']) {
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: role === 'owner' ? 'u1' : 'u2',
      email: 'u@x.co',
      displayName: role === 'owner' ? 'Owner' : 'Test Two',
      role,
      branchId: 'main',
      secondFactor: role === 'owner',
    },
  });
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sales" element={<SalesHistoryPage />} />
        <Route path="/sales/:saleId" element={<SaleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const historyCalls = () => server.calls.filter((call) => call.fn === 'sales_history');

beforeEach(() => {
  server.history = [];
  server.historyError = false;
  server.detail = null;
  server.detailError = null;
  server.calls = [];
  server.outbox = [];
  signInAs('sales');
});

describe('the days (SRS 6.1: staff see 30 days)', () => {
  it('Today, Yesterday, This week and All 30 days', () => {
    expect(rangeFor('today', '2026-11-14')).toEqual({ from: '2026-11-14', to: '2026-11-14' });
    expect(rangeFor('yesterday', '2026-11-14')).toEqual({ from: '2026-11-13', to: '2026-11-13' });
    expect(rangeFor('week', '2026-11-14')).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(rangeFor('all', '2026-11-14')).toEqual({ from: '2026-10-16', to: '2026-11-14' });
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28');
  });

  it('names the days', () => {
    expect(dayHeading('2026-11-14', '2026-11-14')).toBe('Today');
    expect(dayHeading('2026-11-13', '2026-11-14')).toBe('Yesterday');
    expect(dayHeading('2026-11-09', '2026-11-14')).toBe('Mon, Nov 9');
  });
});

describe('My sales (staff)', () => {
  it('shows today’s sales under the day’s count and total', async () => {
    server.history = [
      {
        sales: [
          sale(2, today, 45, { methods: ['gcash'], status: 'voided' }),
          sale(1, today, 213.75, { items: 3 }),
        ],
        days: [{ day: today, count: 1, total: 213.75 }],
        hasMore: false,
      },
    ];
    renderAt('/sales');
    expect(screen.getByRole('heading', { name: 'My sales' })).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(await screen.findByText('Today · 1 sale · ₱213.75')).toBeInTheDocument();
    const rows = screen.getAllByRole('link');
    expect(rows[1]).toHaveTextContent('9:00 AM · 3 items');
    expect(rows[1]).toHaveTextContent('TT-20261114-KY96-1 · Cash');
    expect(rows[1]).toHaveTextContent('₱213.75');
    expect(rows[1]).toHaveAttribute('href', '/sales/s1');
    expect(within(rows[0]!).getByText('Voided')).toBeInTheDocument();
    expect(historyCalls()[0]?.args).toMatchObject({
      p_from: today,
      p_to: today,
      p_salesperson: null,
    });
  });

  it('the chips ask for yesterday, the week or 30 days', async () => {
    renderAt('/sales');
    const user = userEvent.setup();
    await screen.findByText('No sales');
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    await user.click(screen.getByRole('button', { name: 'All 30 days' }));
    expect(historyCalls().map((call) => [call.args.p_from, call.args.p_to])).toEqual([
      [today, today],
      [daysBefore(today, 1), daysBefore(today, 1)],
      [daysBefore(today, 29), today],
    ]);
  });

  it('loads the next page after the last sale shown', async () => {
    server.history = [
      { sales: [sale(2, today, 45)], days: [], hasMore: true },
      { sales: [sale(1, today, 90)], days: [], hasMore: false },
    ];
    renderAt('/sales');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('TT-20261114-KY96-1 · Cash')).toBeInTheDocument();
    expect(historyCalls()[1]?.args).toMatchObject({ p_before_id: 's2' });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('lists the sales still on this phone as waiting to sync', async () => {
    server.outbox = [
      {
        id: 'o1',
        kind: 'sale',
        uid: 'u2',
        branchId: 'main',
        madeAt: Date.now(),
        status: 'waiting',
        attempts: 0,
        payload: {
          receipt_no: 'TT-20261114-KY96-9',
          made_at: noon(today, 15),
          total: 45,
          payments: [{ method: 'cash', amount: 45 }],
        },
      } satisfies OutboxItem,
    ];
    renderAt('/sales');
    const waiting = within(await screen.findByRole('region', { name: 'Waiting on this phone' }));
    expect(waiting.getByText('On this phone · 1 not sent yet')).toBeInTheDocument();
    expect(waiting.getByText('Waiting to sync')).toBeInTheDocument();
    expect(waiting.getByText('₱45.00')).toBeInTheDocument();
  });

  it('says history needs internet when it can’t load', async () => {
    server.historyError = true;
    renderAt('/sales');
    expect(await screen.findByText('Sales history needs internet.')).toBeInTheDocument();
  });
});

describe('Sales history (the Owner)', () => {
  it('shows everyone, one day at a time, and one salesperson on request', async () => {
    signInAs('owner');
    server.history = [
      {
        sales: [sale(1, today, 213.75)],
        days: [{ day: today, count: 1, total: 213.75 }],
        hasMore: false,
      },
      { sales: [], days: [], hasMore: false },
    ];
    renderAt('/sales');
    const user = userEvent.setup();
    expect(screen.getByRole('heading', { name: 'Sales history' })).toBeInTheDocument();
    expect(screen.queryByText('Last 30 days')).toBeNull();
    expect(await screen.findByText(/· Test Two/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Salesperson'), 'u5');
    expect(historyCalls().at(-1)?.args).toMatchObject({ p_salesperson: 'u5' });
  });
});

describe('one sale', () => {
  it('shows its lines, total and how it was paid', async () => {
    server.detail = {
      id: 's1',
      receiptNo: 'TT-20261114-KY96-1',
      madeAt: noon(today, 14),
      syncedAt: noon(today, 14),
      salesperson: 'Test Two',
      subtotal: 213.75,
      discountTotal: 0,
      rounding: 0.25,
      total: 214,
      vatRate: null,
      vatAmount: null,
      change: 286,
      status: 'completed',
      flags: [],
      madeOffline: false,
      lines: [
        {
          lineNo: 1,
          name: 'Test Chips',
          sku: 'CK',
          unit: 'pack',
          qty: 2,
          unitPrice: 45,
          discount: 0,
          discountName: null,
          lineTotal: 90,
        },
        {
          lineNo: 2,
          name: 'Test Rice',
          sku: 'R',
          unit: 'kg',
          qty: 1.25,
          unitPrice: 99,
          discount: 0,
          discountName: null,
          lineTotal: 123.75,
        },
      ],
      payments: [{ method: 'cash', amount: 214, reference: null, accountLabel: null }],
    };
    renderAt('/sales/s1');
    const items = within(await screen.findByRole('region', { name: 'Items' }));
    expect(screen.getByText('TT-20261114-KY96-1')).toBeInTheDocument();
    expect(items.getByText('Test Chips × 2')).toBeInTheDocument();
    expect(items.getByText('Test Rice × 1.25 kg')).toBeInTheDocument();
    expect(items.getByText('Total').nextSibling).toHaveTextContent('₱214.00');
    expect(items.getByText('Cash ₱500.00 · change ₱286.00')).toBeInTheDocument();
    expect(items.getByText('rounding +₱0.25')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to my sales' })).toHaveAttribute(
      'href',
      '/sales',
    );
  });

  it('a sale not in your history', async () => {
    server.detailError = 'not_found';
    renderAt('/sales/s9');
    expect(await screen.findByText(/This sale isn’t in your history/)).toBeInTheDocument();
  });
});
