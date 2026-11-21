import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '@/stores/session';
import { manilaDay, toSaleDetail } from './history';
import { planRefund, refundableBy } from './returns';
import { SaleDetailPage } from './SaleDetailPage';

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

// 3 chips in a "3 for ₱120" deal and 1.25 kg rice (₱68.75), cash ₱189 (rounded).
const detail = (extra: Json = {}): Json => ({
  id: 's1',
  receiptNo: 'TT-20261120-KY96-1',
  madeAt: `${today}T10:00:00+08:00`,
  syncedAt: `${today}T10:00:00+08:00`,
  salesperson: 'Test Two',
  subtotal: 203.75,
  discountTotal: 15,
  rounding: 0.25,
  total: 189,
  vatRate: null,
  vatAmount: null,
  change: 11,
  status: 'completed',
  flags: [],
  madeOffline: false,
  voidable: 'drawer_closed',
  void: null,
  pendingVoid: null,
  pendingReturn: null,
  returnWindow: { days: 30, late: false },
  roundCash: true,
  refunded: {},
  returns: [],
  lines: [
    {
      lineNo: 1,
      name: 'Test Chips',
      sku: 'CK',
      unit: 'pack',
      qty: 3,
      unitPrice: 45,
      discount: 15,
      discountName: '3 for ₱120',
      lineTotal: 120,
      returnedQty: 0,
      refunded: 0,
    },
    {
      lineNo: 2,
      name: 'Demo Rice',
      sku: 'R',
      unit: 'kg',
      qty: 1.25,
      unitPrice: 55,
      discount: 0,
      discountName: null,
      lineTotal: 68.75,
      returnedQty: 0,
      refunded: 0,
    },
  ],
  payments: [{ method: 'cash', amount: 189, reference: null, accountLabel: null }],
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

describe('the refund (POS-10)', () => {
  const sale = toSaleDetail(detail());

  it('is each unit’s share of what the line was paid, deal included', () => {
    expect(planRefund(sale, [{ lineNo: 1, qty: 1, condition: 'stock' }], 'cash')).toEqual({
      refund: 40,
      handed: 40,
      lines: [{ lineNo: 1, refund: 40 }],
    });
  });

  it('the last units get exactly what is left; cash rounds to the peso', () => {
    const after = toSaleDetail(
      detail({
        lines: [
          { ...(detail().lines as Json[])[0], returnedQty: 1, refunded: 40 },
          (detail().lines as Json[])[1],
        ],
      }),
    );
    expect(
      planRefund(
        after,
        [
          { lineNo: 1, qty: 2, condition: 'damaged' },
          { lineNo: 2, qty: 1.25, condition: 'stock' },
        ],
        'cash',
      ),
    ).toEqual({
      refund: 148.75,
      handed: 149,
      lines: [
        { lineNo: 1, refund: 80 },
        { lineNo: 2, refund: 68.75 },
      ],
    });
  });

  it('never more than was paid each way', () => {
    const split = toSaleDetail(
      detail({
        payments: [
          { method: 'cash', amount: 45, reference: null, accountLabel: null },
          { method: 'gcash', amount: 45, reference: 'G1', accountLabel: null },
        ],
        refunded: { gcash: 45 },
      }),
    );
    expect(refundableBy(split)).toEqual([
      { method: 'cash', left: 45 },
      { method: 'gcash', left: 0 },
    ]);
  });
});

describe('returning items', () => {
  it('Sales picks items and where they go, sees the refund, and asks the Owner', async () => {
    server.details = [
      detail(),
      detail({
        pendingReturn: {
          id: 'r1',
          mine: true,
          reason: 'Wrong flavour',
          refund: 40,
          method: 'cash',
        },
      }),
    ];
    const user = renderSale();
    const row = await screen.findByRole('button', { name: /Return items/ });
    expect(row).toHaveTextContent('Some or all, up to 30 days after the sale');
    await user.click(row);
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByText('Ask to return items')).toBeInTheDocument();

    await user.click(sheet.getByRole('button', { name: 'Send to the Owner' }));
    expect(sheet.getByText('Pick at least one item to return.')).toBeInTheDocument();

    await user.type(sheet.getByRole('textbox', { name: /Test Chips/ }), '4');
    await user.click(sheet.getByRole('button', { name: 'Send to the Owner' }));
    expect(sheet.getByText('Test Chips: only 3 left to return.')).toBeInTheDocument();

    await user.clear(sheet.getByRole('textbox', { name: /Test Chips/ }));
    await user.type(sheet.getByRole('textbox', { name: /Test Chips/ }), '1');
    expect(sheet.getByText('Refund').nextSibling).toHaveTextContent('₱40.00');
    expect(sheet.getByText('Cash from today’s drawer').nextSibling).toHaveTextContent('₱40.00');
    await user.click(sheet.getByRole('radio', { name: 'Damaged' }));
    await user.type(sheet.getByLabelText('Reason'), 'Wrong flavour');
    await user.click(sheet.getByRole('button', { name: 'Send to the Owner' }));

    expect(calls('request_sale_return')[0]?.args).toMatchObject({
      p_sale_id: 's1',
      p_items: [{ lineNo: 1, qty: 1, condition: 'damaged' }],
      p_refund_method: 'cash',
      p_reason: 'Wrong flavour',
      p_defective: false,
    });
    expect(await screen.findByText(/You asked for a return/)).toBeInTheDocument();
  });

  it('past the window, only a defective item, marked so', async () => {
    server.details = [detail({ returnWindow: { days: 30, late: true } })];
    const user = renderSale();
    const row = await screen.findByRole('button', { name: /Return items/ });
    expect(row).toHaveTextContent('Past the 30-day return window: defective items only');
    await user.click(row);
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByRole('textbox', { name: /Test Chips/ }), '1');
    await user.type(sheet.getByLabelText('Reason'), 'Seal broken');
    await user.click(sheet.getByRole('button', { name: 'Send to the Owner' }));
    expect(sheet.getByText(/Only a defective item can be returned/)).toBeInTheDocument();
    await user.click(sheet.getByRole('checkbox', { name: /The item is defective/ }));
    await user.click(sheet.getByRole('button', { name: 'Send to the Owner' }));
    expect(calls('request_sale_return')[0]?.args).toMatchObject({ p_defective: true });
  });

  it('the Owner returns directly; a GCash refund needs its reference', async () => {
    signInAs('owner');
    server.details = [
      detail({
        payments: [
          { method: 'cash', amount: 89, reference: null, accountLabel: null },
          { method: 'gcash', amount: 100, reference: 'G1', accountLabel: null },
        ],
      }),
    ];
    const user = renderSale();
    await user.click(await screen.findByRole('button', { name: /Return items/ }));
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByRole('textbox', { name: /Test Chips/ }), '2');
    await user.click(sheet.getByRole('radio', { name: 'GCash' }));
    expect(sheet.getByText('GCash: you send it back').nextSibling).toHaveTextContent('₱80.00');
    await user.type(sheet.getByLabelText('Reason'), 'Wrong item');
    await user.click(sheet.getByRole('button', { name: 'Return items' }));
    expect(sheet.getByText('Type the reference of the GCash refund you sent.')).toBeInTheDocument();
    await user.type(sheet.getByLabelText('GCash refund reference'), 'GC888');
    await user.click(sheet.getByRole('button', { name: 'Return items' }));
    expect(calls('return_sale')[0]?.args).toMatchObject({
      p_items: [{ lineNo: 1, qty: 2, condition: 'stock' }],
      p_refund_method: 'gcash',
      p_refund_reference: 'GC888',
    });
  });

  it('while a return waits for the Owner, no void is offered either (review of Nov 21)', async () => {
    server.details = [
      detail({
        voidable: 'ok',
        pendingReturn: {
          id: 'r1',
          mine: true,
          reason: 'Wrong flavour',
          refund: 45,
          method: 'cash',
        },
      }),
    ];
    renderSale();
    expect(await screen.findByText(/You asked for a return/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Void the sale/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Return items/ })).toBeNull();
  });

  it('after a partial return: the tag, and what is left to refund on each line', async () => {
    server.details = [
      detail({
        refunded: { cash: 40 },
        returns: [
          {
            at: `${today}T11:00:00+08:00`,
            by: 'Owner',
            reason: 'Wrong flavour',
            refund: 40,
            cashRefund: 40,
            method: 'cash',
            refundReference: null,
            defective: false,
            items: [{ name: 'Test Chips', unit: 'pack', qty: 1, condition: 'stock', refund: 40 }],
          },
        ],
        lines: [
          { ...(detail().lines as Json[])[0], returnedQty: 1, refunded: 40 },
          (detail().lines as Json[])[1],
        ],
      }),
    ];
    const user = renderSale();
    expect(await screen.findByText('Part returned')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Return items/ }));
    const sheet = within(screen.getByRole('dialog'));
    expect(
      sheet.getByText(/2 left to return · ₱80.00 left to refund of ₱120.00/),
    ).toBeInTheDocument();
    expect(sheet.getByText(/1.25 kg left to return · ₱68.75 paid/)).toBeInTheDocument();
  });

  it('shows the returns made, and stops offering what is all back', async () => {
    server.details = [
      detail({
        voidable: 'sale_has_returns',
        refunded: { cash: 188.75 },
        returns: [
          {
            at: `${today}T11:00:00+08:00`,
            by: 'Owner',
            reason: 'Spoiled',
            refund: 148.75,
            cashRefund: 149,
            method: 'cash',
            refundReference: null,
            defective: false,
            items: [
              { name: 'Test Chips', unit: 'pack', qty: 2, condition: 'damaged', refund: 80 },
              { name: 'Demo Rice', unit: 'kg', qty: 1.25, condition: 'stock', refund: 68.75 },
            ],
          },
        ],
        lines: (detail().lines as Json[]).map((line) => ({
          ...line,
          returnedQty: line.qty,
          refunded: line.lineTotal,
        })),
      }),
    ];
    renderSale();
    expect(await screen.findByText(/Returned .* by Owner/)).toBeInTheDocument();
    expect(screen.getByText(/Test Chips × 2 · damaged · ₱80.00/)).toBeInTheDocument();
    expect(screen.getByText(/Demo Rice × 1.25 kg · back to stock/)).toBeInTheDocument();
    expect(screen.getByText(/Refund ₱148.75 Cash \(₱149.00 from the drawer\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Return items/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Void the sale/ })).toBeNull();
    expect(screen.queryByText('Something wrong with this sale?')).toBeNull();
  });

  it('the Owner’s note is hidden when nothing can be done (review of Nov 19)', async () => {
    signInAs('owner');
    server.details = [
      detail({
        refunded: { cash: 189 },
        lines: (detail().lines as Json[]).map((line) => ({ ...line, returnedQty: 0 })),
      }),
    ];
    renderSale();
    expect(await screen.findByRole('button', { name: /Void the sale/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Return items/ })).toBeNull();
    expect(screen.queryByText(/You do these straight away/)).toBeNull();
  });
});
