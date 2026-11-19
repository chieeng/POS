import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '@/stores/session';
import { manilaDay } from './history';
import { SaleDetailPage } from './SaleDetailPage';
import { voidAmounts } from './void';

type Json = Record<string, unknown>;

const server = vi.hoisted(() => ({
  details: [] as Json[],
  calls: [] as { fn: string; args: Json }[],
  error: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Json) => {
      server.calls.push({ fn, args });
      if (fn === 'sale_detail') {
        const detail = server.details.length > 1 ? server.details.shift() : server.details[0];
        return Promise.resolve({ data: detail, error: null });
      }
      if (server.error) {
        return Promise.resolve({ data: null, error: { message: server.error } });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

const today = manilaDay(new Date());

const detail = (extra: Json = {}): Json => ({
  id: 's1',
  receiptNo: 'TT-20261119-KY96-1',
  madeAt: `${today}T14:00:00+08:00`,
  syncedAt: `${today}T14:00:00+08:00`,
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
  voidable: 'ok',
  void: null,
  pendingVoid: null,
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

function renderSale() {
  render(
    <MemoryRouter initialEntries={['/sales/s1']}>
      <Routes>
        <Route path="/sales/:saleId" element={<SaleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const calls = (fn: string) => server.calls.filter((call) => call.fn === fn);

beforeEach(() => {
  server.details = [detail()];
  server.calls = [];
  server.error = null;
  signInAs('sales');
});

describe('voiding a sale (POS-10)', () => {
  it('what a void gives back: cash from the drawer, GCash/Maya sent by the Owner', () => {
    expect(
      voidAmounts({
        payments: [
          { method: 'cash', amount: 100, reference: null, accountLabel: null },
          { method: 'gcash', amount: 45.5, reference: 'R1', accountLabel: null },
        ],
      }),
    ).toEqual({ cash: 100, ewallet: 45.5 });
  });

  it('Sales asks the Owner, with a reason, and then sees the request waiting', async () => {
    server.details = [
      detail(),
      detail({ pendingVoid: { id: 'r1', mine: true, reason: 'Wrong item' } }),
    ];
    const user = renderSale();
    await user.click(await screen.findByRole('button', { name: /Void the sale/ }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByText('Ask to void this sale?')).toBeInTheDocument();
    expect(sheet.getByText('Back to stock: 3 items')).toBeInTheDocument();
    expect(
      sheet.getByText('Cash back to the customer, from today’s drawer').nextSibling,
    ).toHaveTextContent('₱214.00');

    await user.click(sheet.getByRole('button', { name: 'Send to the Owner' }));
    expect(sheet.getByText('Say why the sale should be voided.')).toBeInTheDocument();
    expect(calls('request_sale_void')).toEqual([]);

    await user.type(sheet.getByLabelText('Reason'), 'Wrong item');
    await user.click(sheet.getByRole('button', { name: 'Send to the Owner' }));
    expect(calls('request_sale_void')[0]?.args).toMatchObject({
      p_sale_id: 's1',
      p_reason: 'Wrong item',
    });
    expect(await screen.findByText(/Request sent. The Owner will decide/)).toBeInTheDocument();
    expect(await screen.findByText('You asked to void this sale.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My requests' })).toHaveAttribute('href', '/requests');
  });

  it('a sale whose drawer was closed cannot be voided, and says why', async () => {
    server.details = [detail({ voidable: 'drawer_closed' })];
    renderSale();
    const button = await screen.findByRole('button', { name: /Void the sale/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Its drawer was closed, so it can no longer be voided.');
  });

  it('a sale still waiting for a drawer can be voided once one opens', async () => {
    server.details = [detail({ voidable: 'drawer_waiting' })];
    renderSale();
    expect(await screen.findByRole('button', { name: /Void the sale/ })).toHaveTextContent(
      'This sale is waiting for today’s drawer.',
    );
  });

  it('the Owner voids directly; a GCash part needs the refund’s reference', async () => {
    signInAs('owner');
    server.details = [
      detail({
        payments: [
          { method: 'cash', amount: 114, reference: null, accountLabel: null },
          { method: 'gcash', amount: 100, reference: 'GC1', accountLabel: 'Store GCash' },
        ],
      }),
      detail({
        status: 'voided',
        voidable: 'sale_not_completed',
        void: {
          at: `${today}T15:00:00+08:00`,
          by: 'Owner',
          reason: 'Customer returned at once',
          refundReference: 'GC555',
        },
      }),
    ];
    const user = renderSale();
    await user.click(await screen.findByRole('button', { name: /Void the sale/ }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByText('GCash: you send it back').nextSibling).toHaveTextContent('₱100.00');
    await user.type(sheet.getByLabelText('Reason'), 'Customer returned at once');
    await user.click(sheet.getByRole('button', { name: 'Void the sale' }));
    expect(sheet.getByText('Type the reference of the GCash refund you sent.')).toBeInTheDocument();
    await user.type(sheet.getByLabelText('GCash refund reference'), 'GC555');
    await user.click(sheet.getByRole('button', { name: 'Void the sale' }));
    expect(calls('void_sale')[0]?.args).toMatchObject({
      p_sale_id: 's1',
      p_reason: 'Customer returned at once',
      p_refund_reference: 'GC555',
    });
    expect(await screen.findByText(/Voided .* by Owner\./)).toBeInTheDocument();
    expect(screen.getByText(/GCash\/Maya refund ref GC555/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Void the sale/ })).toBeNull();
  });

  it('the Owner sees a staff request waiting, and where to decide', async () => {
    signInAs('owner');
    server.details = [detail({ pendingVoid: { id: 'r1', mine: false, reason: 'Wrong item' } })];
    renderSale();
    expect(await screen.findByText('Test Two asked to void this sale:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/approvals');
  });

  it('a refusal from the server is explained', async () => {
    server.error = 'drawer_closed';
    const user = renderSale();
    await user.click(await screen.findByRole('button', { name: /Void the sale/ }));
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByLabelText('Reason'), 'Wrong item');
    await user.click(sheet.getByRole('button', { name: 'Send to the Owner' }));
    expect(
      await sheet.findByText(/Its drawer was closed, so it can no longer be voided/),
    ).toBeInTheDocument();
  });
});
