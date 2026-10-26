import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import type { Category, Product, Supplier } from '@/features/catalog/data';
import type { AuditRecord } from '@/features/users/data';
import { useSession, type SessionUser } from '@/stores/session';
import {
  describeStockError,
  isLowStock,
  recordStockIn,
  type Movement,
  type StockReceipt,
} from './data';
import { LowStockCard } from './LowStockCard';
import { NewStockInPage } from './NewStockInPage';
import { StockHistory } from './StockHistory';
import { StockReceiptPage } from './StockReceiptPage';

const state = vi.hoisted(() => ({
  products: [] as Product[],
  suppliers: [] as Supplier[],
  categories: [] as Category[],
  receipts: [] as StockReceipt[],
  history: [] as Movement[],
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('@/features/catalog/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/data')>()),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
  useSuppliers: () => ({ data: state.suppliers, loading: false, error: false }),
  useCategories: () => ({ data: state.categories, loading: false, error: false }),
  createProduct: vi.fn(),
}));
vi.mock('@/features/approvals/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/approvals/data')>()),
  useApprovalRequests: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useStockReceipt: () => ({ data: state.receipts, loading: false, error: false }),
  useStockHistory: () => ({ data: state.history, loading: false, error: false }),
  recordStockIn: vi.fn(),
}));

const product = (overrides: Partial<Product>): Product => ({
  id: 'p1',
  sku: 'CK-12',
  name: 'Chips Classic',
  categoryId: 'c1',
  unit: 'pack',
  sellPrice: 45,
  stockQty: 0,
  reorderLevel: 10,
  active: true,
  ...overrides,
});

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
  vi.mocked(recordStockIn).mockResolvedValue('r9');
  state.products = [
    product({}),
    product({
      id: 'p2',
      sku: 'WATER-500',
      name: 'Water 500 ml',
      unit: 'pc',
      reorderLevel: 0,
      stockQty: 24,
    }),
    product({ id: 'p3', sku: 'OLD-1', name: 'Old candy', active: false }),
  ];
  state.suppliers = [
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
      name: 'Old Supplier',
      contactPerson: null,
      phone: null,
      address: null,
      active: false,
    },
  ];
  state.categories = [{ id: 'c1', name: 'Snacks', active: true }];
  signInAs('special_sales');
});

function renderNew() {
  const router = createMemoryRouter(
    [
      { path: '/stock-in/new', element: <NewStockInPage /> },
      { path: '/stock-in/:receiptId', element: <p>saved page</p> },
    ],
    { initialEntries: ['/stock-in/new'] },
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}

async function addLine(user: ReturnType<typeof userEvent.setup>, search: string, name: string) {
  await user.type(screen.getByLabelText('Find a product by name or SKU'), search);
  const results = screen.getByRole('list', { name: 'Matching products' });
  await user.click(within(results).getByRole('button', { name: new RegExp(name) }));
}

describe('New stock-in (INV-02)', () => {
  test('records the lines with their quantity and unit cost', async () => {
    const { router, user } = renderNew();
    await user.selectOptions(screen.getByLabelText('Supplier (optional)'), 's1');
    await user.type(screen.getByLabelText('DR / invoice number (optional)'), 'DR 1234');
    await addLine(user, 'chips', 'Chips Classic');
    await addLine(user, 'water', 'Water 500 ml');
    await user.type(screen.getByLabelText('Quantity of Chips Classic'), '30');
    await user.type(screen.getByLabelText('Unit cost of Chips Classic'), '34');
    await user.type(screen.getByLabelText('Quantity of Water 500 ml'), '24');
    await user.type(screen.getByLabelText('Unit cost of Water 500 ml'), '8.50');
    expect(screen.getByText('₱1,224.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save stock-in' }));

    expect(recordStockIn).toHaveBeenCalledWith('s1', 'DR 1234', [
      { product_id: 'p1', qty: 30, unit_cost: 34 },
      { product_id: 'p2', qty: 24, unit_cost: 8.5 },
    ]);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/stock-in/r9'));
  });

  test('the opening-stock shortcut fills the reference and clears the supplier', async () => {
    const { user } = renderNew();
    await user.selectOptions(screen.getByLabelText('Supplier (optional)'), 's1');
    await user.click(screen.getByRole('button', { name: /This is the opening stock/ }));
    expect(screen.getByLabelText('DR / invoice number (optional)')).toHaveValue('Opening stock');
    expect(screen.getByLabelText('Supplier (optional)')).toHaveValue('');
  });

  test('a product can be on one line only', async () => {
    const { user } = renderNew();
    await addLine(user, 'chips', 'Chips Classic');
    await addLine(user, 'water', 'Water 500 ml');
    await addLine(user, 'ck-12', 'Chips Classic');
    expect(screen.getByText('Chips Classic is already on line 1.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem', { name: /^Line / })).toHaveLength(2);
  });

  test('only active products and suppliers can be chosen', async () => {
    const { user } = renderNew();
    expect(
      within(screen.getByLabelText('Supplier (optional)')).queryByText('Old Supplier'),
    ).toBeNull();
    await user.type(screen.getByLabelText('Find a product by name or SKU'), 'old');
    expect(
      screen.getByText('Old candy (OLD-1) is inactive. Ask the Owner to reactivate it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Old candy/ })).toBeNull();
    await user.clear(screen.getByLabelText('Find a product by name or SKU'));
    await user.type(screen.getByLabelText('Find a product by name or SKU'), 'nothing like it');
    expect(screen.getByText(/No product matches/)).toBeInTheDocument();
  });

  test('every line needs a whole quantity and a unit cost of at least ₱0.01', async () => {
    const { user } = renderNew();
    await user.click(screen.getByRole('button', { name: 'Save stock-in' }));
    expect(screen.getByText('Add at least one product.')).toBeInTheDocument();
    await addLine(user, 'chips', 'Chips Classic');
    await user.type(screen.getByLabelText('Quantity of Chips Classic'), '2.5');
    await user.click(screen.getByRole('button', { name: 'Save stock-in' }));
    expect(
      screen.getByText('Chips Classic: enter a whole quantity of at least 1.'),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Quantity of Chips Classic'));
    await user.type(screen.getByLabelText('Quantity of Chips Classic'), '10');
    await user.type(screen.getByLabelText('Unit cost of Chips Classic'), '0');
    await user.click(screen.getByRole('button', { name: 'Save stock-in' }));
    expect(
      screen.getByText('Chips Classic: enter the unit cost in pesos, at least ₱0.01.'),
    ).toBeInTheDocument();
    expect(recordStockIn).not.toHaveBeenCalled();
  });

  test('a line can be removed', async () => {
    const { user } = renderNew();
    await addLine(user, 'chips', 'Chips Classic');
    await user.click(screen.getByRole('button', { name: 'Remove Chips Classic' }));
    expect(screen.queryByRole('listitem', { name: /^Line / })).toBeNull();
  });
});

describe('server messages', () => {
  const name = (id: string) => (id === 'p1' ? 'Chips Classic' : 'Water 500 ml');
  test('read as sentences, naming the product', () => {
    expect(
      describeStockError(
        { message: 'duplicate_product', details: '{"product_id": "p1", "line": 3}' },
        name,
      ),
    ).toBe('Chips Classic is already on line 3.');
    expect(describeStockError({ message: 'product_inactive', details: 'p2' }, name)).toBe(
      'Water 500 ml is inactive and cannot be stocked in.',
    );
    expect(describeStockError({ message: 'supplier_inactive' }, name)).toBe(
      'This supplier is inactive. Choose another.',
    );
  });
});

describe('Stock-in page', () => {
  test('shows the lines with their costs and the total', () => {
    state.receipts = [
      {
        id: 'r1',
        supplierId: 's1',
        reference: 'DR 1234',
        receivedByName: 'Maria',
        createdAt: new Date('2026-10-22T10:00:00+08:00'),
        correctsReceiptId: null,
        isDeletion: false,
        correctedByName: null,
        lines: [
          { lineNo: 1, productId: 'p1', qty: 30, unitCost: 34 },
          { lineNo: 2, productId: 'p2', qty: 24, unitCost: 8.5 },
        ],
      },
    ];
    const router = createMemoryRouter(
      [{ path: '/stock-in/:receiptId', element: <StockReceiptPage /> }],
      {
        initialEntries: ['/stock-in/r1'],
      },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText('DR 1234')).toBeInTheDocument();
    expect(screen.getByText('ABC Trading')).toBeInTheDocument();
    expect(screen.getByText('₱1,020.00')).toBeInTheDocument();
    expect(screen.getByText('₱1,224.00')).toBeInTheDocument();
  });
});

describe('Stock history (INV-06)', () => {
  beforeEach(() => {
    state.history = [
      {
        id: '2',
        createdAt: new Date('2026-10-22T10:00:00+08:00'),
        type: 'stock_in',
        qtyChange: 30,
        stockAfter: 40,
        unitCost: 34,
        userName: 'Maria',
        refType: 'stock_receipt',
        refId: 'r1',
      },
    ];
  });

  test('the Owner sees the cost; the change links to its stock-in', () => {
    render(
      <MemoryRouter>
        <StockHistory productId="p1" unit="pack" showCost />
      </MemoryRouter>,
    );
    expect(screen.getByText('+30 pack')).toBeInTheDocument();
    expect(screen.getByText(/→ 40 · Maria · ₱34.00 \/ pack/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock-in' })).toHaveAttribute('href', '/stock-in/r1');
  });

  test('Special Sales sees no cost', () => {
    state.history = [{ ...state.history[0]!, unitCost: null }];
    render(
      <MemoryRouter>
        <StockHistory productId="p1" unit="pack" showCost={false} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/₱/)).toBeNull();
  });
});

describe('Low stock (INV-05)', () => {
  test('at or below the reorder level, active, with a reorder level set', () => {
    expect(isLowStock(product({ stockQty: 10, reorderLevel: 10 }))).toBe(true);
    expect(isLowStock(product({ stockQty: 11, reorderLevel: 10 }))).toBe(false);
    expect(isLowStock(product({ stockQty: 0, reorderLevel: 0 }))).toBe(false);
    expect(isLowStock(product({ stockQty: 0, reorderLevel: 5, active: false }))).toBe(false);
  });

  test('the Owner home card lists them, lowest first', () => {
    state.products = [
      product({ id: 'a', name: 'A', stockQty: 9, reorderLevel: 10 }),
      product({ id: 'b', name: 'B', stockQty: 0, reorderLevel: 10 }),
      product({ id: 'c', name: 'C', stockQty: 50, reorderLevel: 10 }),
    ];
    render(
      <MemoryRouter>
        <LowStockCard />
      </MemoryRouter>,
    );
    expect(screen.getByText('Low stock · 2')).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['B', 'A']);
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

  test('a stock-in reads as a sentence', () => {
    expect(
      describeAudit(
        entry({
          action: 'stock.in',
          after: { reference: 'Opening stock', supplier: null, lines: 2, units: 34, value: 504 },
        }),
        'x',
      ),
    ).toMatchObject({
      what: 'recorded a stock-in “Opening stock”',
      change: '2 lines · 34 units · ₱504.00',
    });
  });

  test('a product change applied by an approval says so', () => {
    expect(
      describeAudit(
        entry({
          action: 'product.update',
          before: { sell_price: 48.5, label: 'Chips Classic', via: 'approval' },
          after: { sell_price: 50 },
        }),
        'x',
      ).what,
    ).toBe('changed product “Chips Classic” (approved request)');
  });
});
