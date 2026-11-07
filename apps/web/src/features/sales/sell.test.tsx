import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Category, Product } from '@/features/catalog/data';
import type { DrawerToday } from '@/features/drawer/data';
import { useSession } from '@/stores/session';
import { cartLinesFor, useCart } from './cart';
import { lineWarning, sellResults, stockState } from './sell';
import { SellPage } from './SellPage';

const state = vi.hoisted(() => ({
  products: [] as Product[],
  categories: [] as Category[],
  drawer: null as DrawerToday | null,
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('@/features/catalog/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/data')>()),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
  useCategories: () => ({ data: state.categories, loading: false, error: false }),
}));
vi.mock('@/features/drawer/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/drawer/data')>()),
  useDrawerToday: () => ({ data: state.drawer, loading: false, error: false, reload: () => {} }),
}));

const product = (overrides: Partial<Product>): Product => ({
  id: 'p1',
  sku: 'CK-12',
  name: 'Chips Classic',
  categoryId: 'c1',
  unit: 'pack',
  sellPrice: 45,
  stockQty: 20,
  reorderLevel: 5,
  active: true,
  photoKey: null,
  ...overrides,
});

const CHIPS = product({});
const RICE = product({
  id: 'p2',
  sku: 'RICE',
  name: 'Rice',
  categoryId: 'c2',
  unit: 'kg',
  sellPrice: 52,
  stockQty: 10,
  reorderLevel: 0,
});
const COLA = product({
  id: 'p3',
  sku: 'COLA-15',
  name: 'Cola 1.5 L',
  categoryId: 'c3',
  sellPrice: 75,
  stockQty: 0,
  reorderLevel: 6,
});
const OLD = product({ id: 'p4', sku: 'OLD-1', name: 'Old candy', active: false });

const OPEN: DrawerToday = {
  today: '2026-11-07',
  session: {
    id: 's1',
    businessDate: '2026-11-07',
    status: 'open',
    openedByName: 'Test Two',
    openedAt: new Date(),
    openingCash: 1000,
  },
  lastCount: null,
  staleOpen: false,
};

function signInAs(uid = 'u1') {
  useSession.setState({
    status: 'signedIn',
    user: {
      uid,
      email: 'u@x.co',
      displayName: 'User',
      role: 'sales',
      branchId: 'main',
      secondFactor: false,
    },
  });
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function renderSell() {
  render(
    <MemoryRouter>
      <SellPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const cartPanel = () => screen.getByRole('complementary', { name: 'Cart' });

beforeEach(() => {
  sessionStorage.clear();
  useCart.setState({ uid: null, lines: [] });
  state.products = [CHIPS, RICE, COLA, OLD];
  state.categories = [
    { id: 'c1', name: 'Snacks', active: true },
    { id: 'c2', name: 'Rice & oil', active: true },
    { id: 'c3', name: 'Drinks', active: true },
    { id: 'c9', name: 'Empty', active: true },
  ];
  state.drawer = OPEN;
  setOnline(true);
  signInAs();
});

describe('finding products (POS-01)', () => {
  test('active products only; a SKU typed exactly comes first', () => {
    const results = sellResults(
      [CHIPS, RICE, COLA, OLD, product({ id: 'p5', sku: 'COLA', name: 'Alpha cola' })],
      'cola',
      null,
    );
    expect(results.map((p) => p.sku)).toEqual(['COLA', 'COLA-15']);
    expect(sellResults([CHIPS, OLD], 'candy', null)).toEqual([]);
    expect(sellResults([CHIPS, RICE], '', 'c2').map((p) => p.sku)).toEqual(['RICE']);
  });

  test('search by name or SKU, and by category chip (only categories with products)', async () => {
    const user = renderSell();
    const list = screen.getByRole('list', { name: 'Products' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Empty' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Rice & oil' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByLabelText('Search name or SKU'), 'ck-12');
    expect(
      within(screen.getByRole('list', { name: 'Products' })).getByText('Chips Classic'),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search name or SKU'));
    await user.type(screen.getByLabelText('Search name or SKU'), 'nothing');
    expect(screen.getByText('No product matches “nothing”.')).toBeInTheDocument();
  });

  test('stock shows on each product: plenty, low (amber) or out (red)', () => {
    expect(stockState(20, 5)).toBe('ok');
    expect(stockState(5, 5)).toBe('low');
    expect(stockState(3, 0)).toBe('ok');
    expect(stockState(0, 6)).toBe('out');
    renderSell();
    expect(screen.getByText('20 pack left')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
  });
});

describe('the cart (POS-02)', () => {
  test('tapping adds one; tapping again adds another; − and + change it; the bin removes it', async () => {
    const user = renderSell();
    await user.click(screen.getByRole('button', { name: /Chips Classic, ₱45.00/ }));
    await user.click(screen.getByRole('button', { name: /Chips Classic, ₱45.00/ }));
    const panel = cartPanel();
    expect(within(panel).getByLabelText('Quantity of Chips Classic')).toHaveTextContent('2');
    expect(within(panel).getByText('₱90.00', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByLabelText('2 in the cart')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'One more Chips Classic' }));
    expect(within(panel).getByLabelText('Quantity of Chips Classic')).toHaveTextContent('3');
    await user.click(within(panel).getByRole('button', { name: 'One less Chips Classic' }));
    await user.click(within(panel).getByRole('button', { name: 'One less Chips Classic' }));
    expect(within(panel).getByRole('button', { name: 'One less Chips Classic' })).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'Remove Chips Classic' }));
    expect(
      within(panel).getByText('The cart is empty. Tap a product to add it.'),
    ).toBeInTheDocument();
  });

  test('a weighed product asks "How many kg?", up to 3 decimals, and can be changed', async () => {
    const user = renderSell();
    await user.click(screen.getByRole('button', { name: /Rice, ₱52.00 per kg/ }));
    const dialog = screen.getByRole('dialog', { name: 'How many kg?' });
    const amount = within(dialog).getByLabelText('Amount (kg)');
    expect(amount).toHaveAttribute('inputmode', 'decimal');
    await user.type(amount, '1.2345');
    await user.click(within(dialog).getByRole('button', { name: 'Add to cart' }));
    expect(
      within(dialog).getByText('Enter the amount in kg, up to 3 decimals, for example 1.25.'),
    ).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '1.25');
    expect(within(dialog).getByText('1.25 kg = ₱65.00')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add to cart' }));

    const panel = cartPanel();
    await user.click(within(panel).getByRole('button', { name: 'Change the amount of Rice' }));
    const again = screen.getByRole('dialog', { name: 'How many kg?' });
    expect(within(again).getByLabelText('Amount (kg)')).toHaveValue('1.25');
    await user.clear(within(again).getByLabelText('Amount (kg)'));
    await user.type(within(again).getByLabelText('Amount (kg)'), '0.5');
    await user.click(within(again).getByRole('button', { name: 'Update cart' }));
    expect(
      within(panel).getByRole('button', { name: 'Change the amount of Rice' }),
    ).toHaveTextContent('0.5 kg');
    expect(useCart.getState().lines).toEqual([{ productId: 'p2', qty: 0.5 }]);
  });

  test('warns before stock goes low or below zero, and still sells (POS-09)', async () => {
    expect(lineWarning(CHIPS, 16)).toEqual({
      kind: 'low',
      text: 'Low stock · 4 pack left after this sale',
    });
    expect(lineWarning(CHIPS, 2)).toBeNull();
    expect(lineWarning(COLA, 1)).toEqual({
      kind: 'neg',
      text: 'Stock shows 0 pack · will go to -1. Count it later.',
    });
    const user = renderSell();
    await user.click(screen.getByRole('button', { name: /Cola 1.5 L/ }));
    expect(
      within(cartPanel()).getByText('Stock shows 0 pack · will go to -1. Count it later.'),
    ).toBeInTheDocument();
  });

  test('the phone bar shows the count and total; Pay waits for the next update', async () => {
    const user = renderSell();
    await user.click(screen.getByRole('button', { name: /Chips Classic/ }));
    expect(screen.getByRole('button', { name: /1 item · ₱45.00/ })).toBeInTheDocument();
    expect(within(cartPanel()).getByRole('button', { name: 'Pay ₱45.00' })).toBeDisabled();
  });

  test('the cart belongs to the user who filled it', () => {
    useCart.getState().add('u1', CHIPS);
    expect(cartLinesFor(useCart.getState(), 'u1')).toHaveLength(1);
    expect(cartLinesFor(useCart.getState(), 'u2')).toEqual([]);
    useCart.getState().add('u2', RICE, 1);
    expect(useCart.getState().lines).toEqual([{ productId: 'p2', qty: 1 }]);
  });
});

describe('the drawer banner (POS-14)', () => {
  test('no drawer open today: selling is allowed, with a banner and Open the drawer', () => {
    state.drawer = { ...OPEN, session: null };
    renderSell();
    expect(screen.getByText('No drawer is open today.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the drawer' })).toHaveAttribute(
      'href',
      '/drawer',
    );
    expect(screen.getByRole('list', { name: 'Products' })).toBeInTheDocument();
  });

  test("today's drawer closed: new sales go to the next one", () => {
    state.drawer = { ...OPEN, session: { ...OPEN.session!, status: 'closed' } };
    renderSell();
    expect(screen.getByText(/Today's drawer is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open the drawer' })).toBeNull();
  });

  test('nothing is said with the drawer open, or offline', () => {
    renderSell();
    expect(screen.queryByText('No drawer is open today.')).toBeNull();
    state.drawer = { ...OPEN, session: null };
    setOnline(false);
    renderSell();
    expect(screen.queryByText('No drawer is open today.')).toBeNull();
  });
});

describe('no Sign out on Sell', () => {
  test('signing out is in the account menu, not on this screen', () => {
    renderSell();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});
