import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ApprovalRequest } from '@/features/approvals/data';
import { RequestDetails } from '@/features/approvals/RequestDetails';
import type { RequestContext } from '@/features/approvals/context';
import { describeAudit } from '@/features/audit/describe';
import type { Product, Supplier } from '@/features/catalog/data';
import type { AuditRecord } from '@/features/users/data';
import { useSession, type SessionUser } from '@/stores/session';
import { AdjustStockPanel } from './AdjustStockPanel';
import { CorrectionPanel } from './CorrectionPanel';
import {
  adjustStock,
  correctStockIn,
  describeStockError,
  requestStockAdjustment,
  requestStockInCorrection,
  type StockReceipt,
} from './data';
import { StockInListPage } from './StockInListPage';
import { StockReceiptPage } from './StockReceiptPage';

const state = vi.hoisted(() => ({
  requests: [] as ApprovalRequest[],
  receipts: [] as StockReceipt[],
  products: [] as Product[],
  suppliers: [] as Supplier[],
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('@/features/approvals/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/approvals/data')>()),
  useApprovalRequests: () => ({ data: state.requests, loading: false, error: false }),
  withdrawRequest: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/features/catalog/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/data')>()),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
  useSuppliers: () => ({ data: state.suppliers, loading: false, error: false }),
}));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useStockReceipt: () => ({ data: state.receipts, loading: false, error: false }),
  useStockReceipts: () => ({ data: state.receipts, loading: false, error: false }),
  adjustStock: vi.fn(),
  requestStockAdjustment: vi.fn(),
  correctStockIn: vi.fn(),
  requestStockInCorrection: vi.fn(),
}));

const CHIPS: Product = {
  id: 'p1',
  sku: 'CK-12',
  name: 'Chips Classic',
  categoryId: 'c1',
  unit: 'pack',
  sellPrice: 45,
  stockQty: 10,
  reorderLevel: 0,
  active: true,
  photoKey: null,
};

const RECEIPT: StockReceipt = {
  id: 'r1',
  supplierId: 's1',
  reference: 'DR 30',
  receivedByName: 'Maria',
  createdAt: new Date('2026-10-22T10:00:00+08:00'),
  lines: [{ lineNo: 1, productId: 'p1', qty: 10, unitCost: 30 }],
  correctsReceiptId: null,
  isDeletion: false,
  correctedByName: null,
};

function signInAs(role: SessionUser['role']) {
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: 'u1',
      email: 'u@x.co',
      displayName: 'User',
      role,
      branchId: 'main',
      secondFactor: role === 'owner',
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adjustStock).mockResolvedValue(undefined);
  vi.mocked(requestStockAdjustment).mockResolvedValue('q1');
  vi.mocked(correctStockIn).mockResolvedValue('r2');
  vi.mocked(requestStockInCorrection).mockResolvedValue('q2');
  state.requests = [];
  state.receipts = [RECEIPT];
  state.products = [CHIPS];
  state.suppliers = [
    {
      id: 's1',
      name: 'ABC Trading',
      contactPerson: null,
      phone: null,
      address: null,
      active: true,
    },
    { id: 's2', name: 'XYZ Foods', contactPerson: null, phone: null, address: null, active: true },
  ];
  signInAs('owner');
});

const panel = (isOwner: boolean) => {
  render(
    <MemoryRouter>
      <AdjustStockPanel product={CHIPS} isOwner={isOwner} />
    </MemoryRouter>,
  );
  return userEvent.setup();
};

describe('Adjust stock (INV-04)', () => {
  test('the Owner writes off damaged stock directly', async () => {
    const user = panel(true);
    await user.click(screen.getByRole('button', { name: 'Adjust stock' }));
    await user.type(screen.getByLabelText('Quantity (pack)'), '2');
    await user.type(screen.getByLabelText('Reason'), 'Crushed in delivery');
    await user.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(adjustStock).toHaveBeenCalledWith('p1', 'damage', -2, 'Crushed in delivery');
    expect(await screen.findByText('Stock adjusted: −2 pack.')).toBeInTheDocument();
  });

  test('"found" adds to stock; "store use" takes from it', async () => {
    const user = panel(true);
    await user.click(screen.getByRole('button', { name: 'Adjust stock' }));
    await user.selectOptions(screen.getByLabelText('Why'), 'found');
    expect(screen.getByRole('radio', { name: 'Add to stock' })).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Why'), 'store_use');
    expect(screen.getByRole('radio', { name: 'Take out of stock' })).toBeChecked();
    await user.type(screen.getByLabelText('Quantity (pack)'), '1');
    await user.type(screen.getByLabelText('Reason'), 'Snack for the meeting');
    await user.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(adjustStock).toHaveBeenCalledWith('p1', 'store_use', -1, 'Snack for the meeting');
  });

  test('needs a whole quantity and a reason', async () => {
    const user = panel(true);
    await user.click(screen.getByRole('button', { name: 'Adjust stock' }));
    await user.type(screen.getByLabelText('Quantity (pack)'), '1.5');
    await user.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(screen.getByText('Enter a whole quantity of at least 1.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Quantity (pack)'));
    await user.type(screen.getByLabelText('Quantity (pack)'), '1');
    await user.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(screen.getByText('Give a reason.')).toBeInTheDocument();
    expect(adjustStock).not.toHaveBeenCalled();
  });

  test('below zero is explained', async () => {
    vi.mocked(adjustStock).mockRejectedValue({
      message: 'stock_negative',
      details: '{"product_id": "p1", "stock": 10, "result": -1}',
    });
    const user = panel(true);
    await user.click(screen.getByRole('button', { name: 'Adjust stock' }));
    await user.type(screen.getByLabelText('Quantity (pack)'), '11');
    await user.type(screen.getByLabelText('Reason'), 'Missing');
    await user.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(
      await screen.findByText('Chips Classic: only 10 in stock; this would leave -1.'),
    ).toBeInTheDocument();
  });

  test('Special Sales sends a request instead', async () => {
    signInAs('special_sales');
    const user = panel(false);
    await user.click(screen.getByRole('button', { name: 'Request an adjustment' }));
    await user.selectOptions(screen.getByLabelText('Why'), 'expiry');
    await user.type(screen.getByLabelText('Quantity (pack)'), '2');
    await user.type(screen.getByLabelText('Reason'), 'Expired 20 Oct');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(requestStockAdjustment).toHaveBeenCalledWith('p1', 'expiry', -2, 'Expired 20 Oct');
    expect(adjustStock).not.toHaveBeenCalled();
  });

  test('a pending adjustment request shows with Withdraw', () => {
    state.requests = [
      {
        id: 'q1',
        type: 'stock_adjustment',
        targetId: 'p1',
        productId: 'p1',
        before: {},
        after: { type: 'expiry', qty: -2 },
        reason: 'Expired',
        requestedBy: 'u1',
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        ownerNote: null,
        createdAt: new Date(),
      },
    ];
    panel(false);
    expect(
      screen.getByText(/Your adjustment request is waiting for the Owner/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });
});

function renderReceipt(id = 'r1') {
  const router = createMemoryRouter(
    [{ path: '/stock-in/:receiptId', element: <StockReceiptPage /> }],
    { initialEntries: [`/stock-in/${id}`] },
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}

describe('Correct a stock-in (INV-04)', () => {
  test('the Owner corrects the cost; the correction opens', async () => {
    const { router, user } = renderReceipt();
    await user.click(screen.getByRole('button', { name: 'Correct this stock-in' }));
    const cost = screen.getByLabelText('Unit cost of Chips Classic');
    await user.clear(cost);
    await user.type(cost, '20');
    await user.type(screen.getByLabelText('Reason (optional)'), 'Typo');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(correctStockIn).toHaveBeenCalledWith('r1', {
      supplierId: 's1',
      reference: 'DR 30',
      lines: [{ product_id: 'p1', qty: 10, unit_cost: 20 }],
      delete: false,
      reason: 'Typo',
    });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/stock-in/r2'));
  });

  test('the Owner deletes a stock-in', async () => {
    const { user } = renderReceipt();
    await user.click(screen.getByRole('button', { name: 'Correct this stock-in' }));
    await user.click(screen.getByLabelText(/Delete this stock-in/));
    await user.click(screen.getByRole('button', { name: 'Delete stock-in' }));
    expect(correctStockIn).toHaveBeenCalledWith('r1', expect.objectContaining({ delete: true }));
  });

  test('Special Sales requests a correction, with a reason', async () => {
    signInAs('special_sales');
    const { user } = renderReceipt();
    await user.click(screen.getByRole('button', { name: 'Request a correction' }));
    const qty = screen.getByLabelText('Quantity of Chips Classic');
    await user.clear(qty);
    await user.type(qty, '12');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText('Give a reason for the Owner.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Reason'), 'Two more packs');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(requestStockInCorrection).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ lines: [{ product_id: 'p1', qty: 12, unit_cost: 30 }] }),
    );
    expect(correctStockIn).not.toHaveBeenCalled();
    expect(await screen.findByText(/Request sent/)).toBeInTheDocument();
  });

  test('a corrected stock-in links to its correction and cannot be corrected again', () => {
    state.receipts = [
      RECEIPT,
      {
        ...RECEIPT,
        id: 'r2',
        correctsReceiptId: 'r1',
        correctedByName: 'Rosario',
        lines: [{ lineNo: 1, productId: 'p1', qty: 10, unitCost: 20 }],
      },
    ];
    renderReceipt('r1');
    expect(screen.getByText(/Corrected on .* by Rosario\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the correction' })).toHaveAttribute(
      'href',
      '/stock-in/r2',
    );
    expect(screen.queryByRole('button', { name: 'Correct this stock-in' })).toBeNull();
  });

  test('a correction links back to what it corrects', () => {
    state.receipts = [
      { ...RECEIPT, id: 'r2', correctsReceiptId: 'r1', correctedByName: 'Rosario' },
    ];
    renderReceipt('r2');
    expect(screen.getByText('Correction')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the stock-in as first recorded' })).toHaveAttribute(
      'href',
      '/stock-in/r1',
    );
  });

  test('the list says who corrected another person’s stock-in', () => {
    state.receipts = [
      { ...RECEIPT, id: 'r2', correctsReceiptId: 'r1', correctedByName: 'Rosario' },
      {
        ...RECEIPT,
        id: 'r3',
        reference: 'DR 31',
        correctsReceiptId: 'r9',
        correctedByName: 'Maria',
      },
      RECEIPT,
    ];
    render(
      <MemoryRouter>
        <StockInListPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/corrected by Rosario/)).toHaveLength(1);
    expect(screen.queryByText(/corrected by Maria/)).toBeNull();
  });

  test('errors read as sentences', () => {
    expect(describeStockError({ message: 'receipt_corrected' }, () => '')).toBe(
      'This stock-in was already corrected. Correct the newer version instead.',
    );
  });

  test('the correction panel offers only active suppliers, plus the current one', async () => {
    state.suppliers = [
      {
        id: 's1',
        name: 'ABC Trading',
        contactPerson: null,
        phone: null,
        address: null,
        active: false,
      },
      {
        id: 's2',
        name: 'XYZ Foods',
        contactPerson: null,
        phone: null,
        address: null,
        active: true,
      },
      {
        id: 's3',
        name: 'Gone Ltd',
        contactPerson: null,
        phone: null,
        address: null,
        active: false,
      },
    ];
    render(
      <MemoryRouter>
        <CorrectionPanel
          receipt={RECEIPT}
          products={new Map([['p1', CHIPS]])}
          suppliers={state.suppliers}
          isOwner
        />
      </MemoryRouter>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Correct this stock-in' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['No supplier', 'ABC Trading (inactive)', 'XYZ Foods']);
  });
});

describe('the new request types on the Approvals page', () => {
  const context = {
    loading: false,
    error: false,
    productById: new Map([['p1', CHIPS]]),
    receiptById: new Map(),
    categories: [],
    suppliers: [
      {
        id: 's1',
        name: 'ABC Trading',
        contactPerson: null,
        phone: null,
        address: null,
        active: true,
      },
      {
        id: 's2',
        name: 'XYZ Foods',
        contactPerson: null,
        phone: null,
        address: null,
        active: true,
      },
    ],
    outdated: () => false,
    title: () => ({ label: '', to: '' }),
  } as unknown as RequestContext;
  const base = {
    id: 'q',
    reason: 'r',
    requestedBy: 'u1',
    status: 'pending' as const,
    decidedBy: null,
    decidedAt: null,
    ownerNote: null,
    createdAt: new Date(),
  };

  test('an adjustment shows the type, the change and the stock now', () => {
    render(
      <RequestDetails
        request={{
          ...base,
          type: 'stock_adjustment',
          targetId: 'p1',
          productId: 'p1',
          before: {},
          after: { type: 'expiry', qty: -2 },
        }}
        context={context}
        outdated={false}
      />,
    );
    expect(screen.getByText('Expiry')).toBeInTheDocument();
    expect(screen.getByText('−2 pack')).toBeInTheDocument();
    expect(screen.getByText(/now 10 in stock/)).toBeInTheDocument();
  });

  test('a correction shows the lines as recorded and as requested, and a new supplier', () => {
    render(
      <RequestDetails
        request={{
          ...base,
          type: 'stock_in_correction',
          targetId: 'r1',
          productId: '',
          before: {
            supplier_id: 's1',
            reference: 'DR 30',
            lines: [{ product_id: 'p1', qty: 10, unit_cost: 30 }],
          },
          after: {
            supplier_id: 's2',
            reference: 'DR 30',
            delete: false,
            lines: [{ product_id: 'p1', qty: 10, unit_cost: 20 }],
          },
        }}
        context={context}
        outdated={false}
      />,
    );
    expect(screen.getByText('XYZ Foods')).toBeInTheDocument();
    expect(screen.getByText('10 @ ₱30.00')).toBeInTheDocument();
    expect(screen.getByText('10 @ ₱20.00')).toBeInTheDocument();
  });

  test('a deletion request says so', () => {
    render(
      <RequestDetails
        request={{
          ...base,
          type: 'stock_in_correction',
          targetId: 'r1',
          productId: '',
          before: {
            supplier_id: 's1',
            reference: 'DR 30',
            lines: [{ product_id: 'p1', qty: 10, unit_cost: 30 }],
          },
          after: { supplier_id: 's1', reference: 'DR 30', delete: true, lines: [] },
        }}
        context={context}
        outdated={false}
      />,
    );
    expect(screen.getByText(/Delete this stock-in/)).toBeInTheDocument();
    expect(screen.getByText('removed')).toBeInTheDocument();
  });
});

describe('audit log', () => {
  const entry = (overrides: Partial<AuditRecord>): AuditRecord => ({
    id: '1',
    action: '',
    actorId: 'o1',
    targetId: 'x',
    deviceTag: null,
    before: null,
    after: null,
    reason: null,
    createdAt: null,
    ...overrides,
  });

  test('a stock-in with one line says "1 line"', () => {
    expect(
      describeAudit(
        entry({ action: 'stock.in', after: { reference: 'DR 1', lines: 1, units: 1, value: 30 } }),
        'x',
      ).change,
    ).toBe('1 line · 1 unit · ₱30.00');
  });

  test('adjustments and corrections read as sentences', () => {
    expect(
      describeAudit(
        entry({
          action: 'stock.adjust',
          after: {
            label: 'Chips Classic',
            type: 'store_use',
            qty: -1,
            unit: 'pack',
            stock_after: 9,
            via: 'approval',
          },
          reason: 'Snack',
        }),
        'x',
      ),
    ).toMatchObject({
      what: 'adjusted the stock of “Chips Classic” (approved request)',
      change: 'Store use −1 pack · now 9 · Snack',
    });
    expect(
      describeAudit(
        entry({
          action: 'stock.correct',
          before: { reference: 'DR 30' },
          after: { deleted: true },
          reason: 'Twice',
        }),
        'x',
      ),
    ).toMatchObject({ what: 'deleted the stock-in “DR 30”', change: 'Twice' });
    expect(
      describeAudit(
        entry({
          action: 'stock.correct',
          before: {
            reference: 'DR 30',
            supplier_id: 's1',
            lines: [
              { product_id: 'p1', name: 'Chips Classic', qty: 10, unit_cost: 34 },
              { product_id: 'p2', name: 'Soda 1 L', qty: 12, unit_cost: 50 },
              { product_id: 'p3', name: 'Water 500 ml', qty: 5, unit_cost: 8 },
            ],
          },
          after: {
            reference: 'DR 30',
            supplier_id: 's1',
            deleted: false,
            via: 'approval',
            lines: {
              p1: { qty: 10, unit_cost: 32 },
              p2: { qty: 10, unit_cost: 50 },
              p3: { qty: 6, unit_cost: 9 },
            },
          },
          reason: 'Price was wrong',
        }),
        'x',
      ),
    ).toMatchObject({
      what: 'corrected the stock-in “DR 30” (approved request)',
      change:
        'Chips Classic: ₱34.00 → ₱32.00 · Soda 1 L: 12 → 10 · Water 500 ml: 5 @ ₱8.00 → 6 @ ₱9.00 · Price was wrong',
    });
  });
});
