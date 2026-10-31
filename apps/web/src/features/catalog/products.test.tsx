import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { withdrawRequest, type ApprovalRequest } from '@/features/approvals/data';
import { describeAudit } from '@/features/audit/describe';
import type { AuditRecord } from '@/features/users/data';
import { useSession, type SessionUser } from '@/stores/session';
import { AddProductPage } from './AddProductPage';
import {
  createProduct,
  describeCatalogError,
  updateProduct,
  type Category,
  type PriceChange,
  type Product,
} from './data';
import { matchesSearch } from './helpers';
import { replaceProductPhoto } from './photos';
import { ProductDetailPage } from './ProductDetailPage';
import { ProductsPage } from './ProductsPage';

const state = vi.hoisted(() => ({
  categories: [] as Category[],
  products: [] as Product[],
  history: [] as PriceChange[],
  requests: [] as ApprovalRequest[],
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('@/features/stock/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/stock/data')>()),
  useProductCost: () => ({ data: [33], loading: false, error: false }),
  useStockHistory: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('@/features/approvals/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/approvals/data')>()),
  useApprovalRequests: () => ({ data: state.requests, loading: false, error: false }),
  withdrawRequest: vi.fn(),
}));
vi.mock('./photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./photos')>()),
  replaceProductPhoto: vi.fn(),
}));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useCategories: () => ({ data: state.categories, loading: false, error: false }),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
  usePriceChanges: () => ({ data: state.history, loading: false, error: false }),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

const CHIPS: Product = {
  id: 'p1',
  sku: 'CK-12',
  name: 'Chips Classic',
  categoryId: 'c1',
  unit: 'pack',
  sellPrice: 45,
  stockQty: 0,
  reorderLevel: 10,
  active: true,
  photoKey: null,
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

function renderAt(path: string, state?: unknown) {
  const router = createMemoryRouter(
    [
      { path: '/products', element: <ProductsPage /> },
      { path: '/products/new', element: <AddProductPage /> },
      { path: '/products/:productId', element: <ProductDetailPage /> },
    ],
    { initialEntries: [{ pathname: path, state }] },
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createProduct).mockResolvedValue('p9');
  vi.mocked(updateProduct).mockResolvedValue();
  vi.mocked(replaceProductPhoto).mockResolvedValue();
  vi.mocked(withdrawRequest).mockResolvedValue(undefined);
  state.requests = [];
  state.categories = [
    { id: 'c1', name: 'Snacks', active: true },
    { id: 'c2', name: 'Drinks', active: true },
    { id: 'c3', name: 'Old stock', active: false },
  ];
  state.products = [
    CHIPS,
    {
      ...CHIPS,
      id: 'p2',
      sku: 'WATER-500',
      name: 'Water 500 ml',
      categoryId: 'c2',
      unit: 'pc',
      sellPrice: 15,
    },
    { ...CHIPS, id: 'p3', sku: 'OLD-1', name: 'Old candy', categoryId: 'c3', active: false },
  ];
  state.history = [
    {
      id: 'h2',
      oldPrice: 45,
      newPrice: 48.5,
      source: 'owner_edit',
      changedByName: 'Rosario',
      createdAt: new Date('2026-10-18T14:15:00+08:00'),
    },
    {
      id: 'h1',
      oldPrice: null,
      newPrice: 45,
      source: 'created',
      changedByName: 'Maria',
      createdAt: new Date('2026-10-17T09:00:00+08:00'),
    },
  ];
  signInAs('owner');
});

describe('Products list', () => {
  test('search matches the name or the SKU, ignoring case', () => {
    expect(matchesSearch(CHIPS, 'chips')).toBe(true);
    expect(matchesSearch(CHIPS, 'ck-1')).toBe(true);
    expect(matchesSearch(CHIPS, '  ')).toBe(true);
    expect(matchesSearch(CHIPS, 'water')).toBe(false);
  });

  test('shows active products with price per unit; inactive ones only on request', async () => {
    const { user } = renderAt('/products');
    expect(screen.getByText('Chips Classic')).toBeInTheDocument();
    expect(screen.getByText('₱45.00')).toBeInTheDocument();
    expect(screen.getByText(/\/ pack · 0 in stock/)).toBeInTheDocument();
    expect(screen.queryByText('Old candy')).toBeNull();
    await user.click(screen.getByLabelText('Show inactive'));
    expect(screen.getByText('Old candy')).toBeInTheDocument();
  });

  test('filters by search and by category', async () => {
    const { user } = renderAt('/products');
    await user.type(screen.getByLabelText('Search by name or SKU'), 'water');
    expect(screen.getByText('Water 500 ml')).toBeInTheDocument();
    expect(screen.queryByText('Chips Classic')).toBeNull();
    await user.clear(screen.getByLabelText('Search by name or SKU'));
    await user.selectOptions(screen.getByLabelText('Category'), 'c1');
    expect(screen.getByText('Chips Classic')).toBeInTheDocument();
    expect(screen.queryByText('Water 500 ml')).toBeNull();
  });

  test('the filters survive opening a product and coming back', async () => {
    const { router, user } = renderAt('/products');
    await user.type(screen.getByLabelText('Search by name or SKU'), 'old');
    await user.selectOptions(screen.getByLabelText('Category'), 'c3');
    await user.click(screen.getByLabelText('Show inactive'));
    expect(router.state.location.search).toBe('?q=old&category=c3&inactive=1');
    await user.click(screen.getByRole('link', { name: /Old candy/ }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/products/p3'));
    await router.navigate(-1);
    expect(await screen.findByLabelText('Search by name or SKU')).toHaveValue('old');
    expect(screen.getByLabelText('Category')).toHaveValue('c3');
    expect(screen.getByLabelText('Show inactive')).toBeChecked();
    expect(screen.getByText('Old candy')).toBeInTheDocument();
  });

  test('the product page’s back arrow returns to the list with its filters', async () => {
    const { router, user } = renderAt('/products');
    await user.type(screen.getByLabelText('Search by name or SKU'), 'chips');
    await user.click(screen.getByRole('link', { name: /Chips Classic/ }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/products/p1'));
    expect(screen.getByRole('link', { name: 'Back to products' })).toHaveAttribute(
      'href',
      '/products?q=chips',
    );
  });

  test('opened from elsewhere, the back arrow goes to the plain list', () => {
    renderAt('/products/p1');
    expect(screen.getByRole('link', { name: 'Back to products' })).toHaveAttribute(
      'href',
      '/products',
    );
  });

  test.each(['owner', 'special_sales'] as const)('%s can add products', (role) => {
    signInAs(role);
    renderAt('/products');
    expect(screen.getByRole('link', { name: 'Add product' })).toBeInTheDocument();
  });

  test('Sales sees the list but cannot add', () => {
    signInAs('sales');
    renderAt('/products');
    expect(screen.getByText('Chips Classic')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add product' })).toBeNull();
  });
});

describe('Add product (PROD-02, PROD-03)', () => {
  test('saves the product with the SKU in capitals and opens it', async () => {
    signInAs('special_sales');
    const { router, user } = renderAt('/products/new');
    await user.type(screen.getByLabelText('Product name'), ' Cola 1.5 L ');
    await user.type(screen.getByLabelText('SKU'), 'cola-15');
    await user.selectOptions(screen.getByLabelText('Category'), 'c2');
    await user.selectOptions(screen.getByLabelText('Unit'), 'bottle');
    await user.type(screen.getByLabelText('Selling price (₱)'), '75.50');
    await user.click(screen.getByRole('button', { name: 'Add product' }));

    expect(createProduct).toHaveBeenCalledWith({
      sku: 'COLA-15',
      name: 'Cola 1.5 L',
      category_id: 'c2',
      unit: 'bottle',
      sell_price: 75.5,
      reorder_level: 0,
    });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/products/p9'));
  });

  test('inactive categories cannot be chosen', () => {
    renderAt('/products/new');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Snacks');
    expect(options).not.toContain('Old stock');
  });

  test('refuses a bad SKU, a missing category and a zero price', async () => {
    const { user } = renderAt('/products/new');
    await user.type(screen.getByLabelText('Product name'), 'X');
    await user.type(screen.getByLabelText('SKU'), 'CK 12');
    await user.type(screen.getByLabelText('Selling price (₱)'), '0');
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(await screen.findByText('Use 1 to 20 letters, digits or dashes.')).toBeInTheDocument();
    expect(screen.getByText('Choose a category.')).toBeInTheDocument();
    expect(screen.getByText('Use ₱0.01 to ₱1,000,000.')).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  test('a refused save’s message goes away once the form is edited', async () => {
    vi.mocked(createProduct).mockRejectedValue({ code: '23505', message: 'sku_taken' });
    const { user } = renderAt('/products/new');
    await user.type(screen.getByLabelText('Product name'), 'Copy');
    await user.type(screen.getByLabelText('SKU'), 'ck-12');
    await user.selectOptions(screen.getByLabelText('Category'), 'c1');
    await user.type(screen.getByLabelText('Selling price (₱)'), '45');
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(await screen.findByText('Another product already uses this SKU.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('SKU'), 'X');
    expect(screen.queryByText('Another product already uses this SKU.')).toBeNull();
  });

  test('…and on a new attempt that fails on the form itself', async () => {
    vi.mocked(createProduct).mockRejectedValue({ code: '23505', message: 'sku_taken' });
    const { user } = renderAt('/products/new');
    await user.type(screen.getByLabelText('Product name'), 'Copy');
    await user.type(screen.getByLabelText('SKU'), 'ck-12');
    await user.selectOptions(screen.getByLabelText('Category'), 'c1');
    await user.type(screen.getByLabelText('Selling price (₱)'), '45');
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(await screen.findByText('Another product already uses this SKU.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Selling price (₱)'));
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(await screen.findByText(/Enter a price in pesos/)).toBeInTheDocument();
    expect(screen.queryByText('Another product already uses this SKU.')).toBeNull();
  });

  test('a SKU already used says so', async () => {
    vi.mocked(createProduct).mockRejectedValue({ code: '23505', message: 'sku_taken' });
    const { user } = renderAt('/products/new');
    await user.type(screen.getByLabelText('Product name'), 'Copy');
    await user.type(screen.getByLabelText('SKU'), 'ck-12');
    await user.selectOptions(screen.getByLabelText('Category'), 'c1');
    await user.type(screen.getByLabelText('Selling price (₱)'), '45');
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(await screen.findByText('Another product already uses this SKU.')).toBeInTheDocument();
  });
});

describe('Product page', () => {
  test('shows the details and the price history, newest first', () => {
    renderAt('/products/p1');
    expect(screen.getByRole('heading', { name: 'Chips Classic' })).toBeInTheDocument();
    expect(screen.getByText('₱45.00 / pack')).toBeInTheDocument();
    expect(screen.getByText('10 pack')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows[0]).toContain('₱45.00 → ₱48.50');
    expect(rows[0]).toContain('Rosario');
    expect(rows[1]).toContain('₱45.00');
    expect(rows[1]).toContain('first price');
  });

  test('the Owner edits the product', async () => {
    const { user } = renderAt('/products/p1');
    await user.click(screen.getByRole('button', { name: 'Edit product' }));
    const price = screen.getByLabelText('Selling price (₱)');
    await user.clear(price);
    await user.type(price, '48.50');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateProduct).toHaveBeenCalledWith('p1', {
      sku: 'CK-12',
      name: 'Chips Classic',
      category_id: 'c1',
      unit: 'pack',
      sell_price: 48.5,
      reorder_level: 10,
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  test('the Owner deactivates after confirming', async () => {
    const { user } = renderAt('/products/p1');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(screen.getByText(/disappears from selling and searches/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Deactivate' }).at(-1)!);
    expect(updateProduct).toHaveBeenCalledWith('p1', { active: false });
  });

  test('a product in an inactive category keeps it as a choice when edited', async () => {
    const { user } = renderAt('/products/p3');
    await user.click(screen.getByRole('button', { name: 'Edit product' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Old stock (inactive)');
  });

  test('Special Sales sees the price history and can request a change', () => {
    signInAs('special_sales');
    renderAt('/products/p1');
    expect(screen.getByRole('button', { name: 'Request a change' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit product' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Price history' })).toBeInTheDocument();
  });

  test('“Photo added.” goes once Special Sales starts a request', async () => {
    signInAs('special_sales');
    const { user } = renderAt('/products/p1');
    await user.upload(
      screen.getByLabelText('Add photo'),
      new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByText('Photo added.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    expect(screen.queryByText('Photo added.')).toBeNull();
  });

  test('…and once they withdraw a request', async () => {
    signInAs('special_sales');
    state.requests = [
      {
        id: 'q1',
        type: 'product_edit',
        targetId: 'p1',
        productId: 'p1',
        before: { sell_price: 45 },
        after: { sell_price: 50 },
        reason: 'Supplier price',
        requestedBy: 'u1',
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        ownerNote: null,
        createdAt: new Date(),
      },
    ];
    const { user } = renderAt('/products/p1');
    await user.upload(
      screen.getByLabelText('Add photo'),
      new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByText('Photo added.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(withdrawRequest).toHaveBeenCalledWith('q1');
    expect(screen.queryByText('Photo added.')).toBeNull();
  });

  test('“Product added.” goes too, and does not come back on reload', async () => {
    signInAs('special_sales');
    const { router, user } = renderAt('/products/p1', { added: true, photoFailed: false });
    expect(screen.getByText('Product added.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    expect(screen.queryByText('Product added.')).toBeNull();
    expect(router.state.location.state).toBeNull();
    expect(router.state.location.pathname).toBe('/products/p1');
  });

  test('Adjust stock sits with the product actions, above the price history', () => {
    renderAt('/products/p1');
    const adjust = screen.getByRole('button', { name: 'Adjust stock' });
    const history = screen.getByRole('heading', { name: 'Price history' });
    expect(adjust.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the Owner sees the average cost and the stock history', () => {
    renderAt('/products/p1');
    expect(screen.getByText('₱33.00 / pack')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stock history' })).toBeInTheDocument();
  });

  test('Special Sales sees the stock history but no cost', () => {
    signInAs('special_sales');
    renderAt('/products/p1');
    expect(screen.queryByText('Average cost')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Stock history' })).toBeInTheDocument();
  });

  test('the Low stock filter shows only products at or below their reorder level', async () => {
    state.products = [
      { ...CHIPS, stockQty: 3 },
      { ...CHIPS, id: 'p2', sku: 'WATER-500', name: 'Water 500 ml', stockQty: 50 },
    ];
    const { user } = renderAt('/products');
    await user.click(screen.getByLabelText('Low stock only'));
    expect(screen.getByText('Chips Classic')).toBeInTheDocument();
    expect(screen.queryByText('Water 500 ml')).toBeNull();
    expect(screen.getByText('Low stock')).toBeInTheDocument();
  });

  test('Sales sees the details only', () => {
    signInAs('sales');
    renderAt('/products/p1');
    expect(screen.getByText('₱45.00 / pack')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Price history' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Stock history' })).toBeNull();
    expect(screen.queryByText('Average cost')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit product' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request a change' })).toBeNull();
  });

  test('an unknown product says so', () => {
    renderAt('/products/nope');
    expect(screen.getByText('This product was not found.')).toBeInTheDocument();
  });
});

describe('messages and audit log', () => {
  test('a category with active products explains what to do', () => {
    expect(
      describeCatalogError({ code: '23503', message: 'category_in_use', details: '3' }, 'category'),
    ).toBe('Move or deactivate its 3 products first.');
    expect(
      describeCatalogError({ code: '23503', message: 'category_in_use', details: '1' }, 'category'),
    ).toBe('Move or deactivate its 1 product first.');
    expect(describeCatalogError({ message: 'category_inactive' }, 'product')).toBe(
      'This category is inactive. Choose an active one.',
    );
  });

  test('product entries read as sentences, with prices in pesos', () => {
    const entry = (overrides: Partial<AuditRecord>): AuditRecord => ({
      id: '1',
      action: '',
      actorId: 'o1',
      targetId: 'p1',
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
          action: 'product.create',
          after: { sku: 'CK-12', name: 'Chips Classic', unit: 'pack', sell_price: 45 },
        }),
        'x',
      ),
    ).toMatchObject({ what: 'added product “Chips Classic” (CK-12)', change: '₱45.00 / pack' });
    expect(
      describeAudit(
        entry({
          action: 'product.update',
          before: { sell_price: 45, category_id: 'c1', label: 'Chips Classic' },
          after: { sell_price: 48.5, category_id: 'c2' },
        }),
        'x',
      ),
    ).toMatchObject({
      what: 'changed product “Chips Classic”',
      change: 'Price: ₱45.00 → ₱48.50 · Category changed',
    });
    expect(
      describeAudit(
        entry({
          action: 'product.update',
          before: { active: true, label: 'Old candy' },
          after: { active: false },
        }),
        'x',
      ).what,
    ).toBe('deactivated product “Old candy”');
  });
});
