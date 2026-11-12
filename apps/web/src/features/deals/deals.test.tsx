import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import type { Product } from '@/features/catalog/data';
import type { AuditRecord } from '@/features/users/data';
import { createDeal, updateDeal } from './data';
import { DealsSection } from './DealsSection';
import type { DealRule } from './rules';

const state = vi.hoisted(() => ({ deals: [] as DealRule[], products: [] as Product[] }));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useDeals: () => ({ data: state.deals, loading: false, error: false }),
  createDeal: vi.fn(() => Promise.resolve('new')),
  updateDeal: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/features/catalog/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/data')>()),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
}));

const product = (
  id: string,
  name: string,
  sku: string,
  unit: Product['unit'] = 'pack',
): Product => ({
  id,
  sku,
  name,
  categoryId: 'c1',
  unit,
  sellPrice: 45,
  stockQty: 10,
  reorderLevel: 0,
  active: true,
  photoKey: null,
});

const CHIPS: DealRule = {
  id: 'q1',
  name: 'Chips 3 for ₱100',
  kind: 'quantity',
  price: 100,
  setSize: 3,
  productIds: ['p1', 'p2'],
  qtys: [],
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.deals = [];
  state.products = [
    product('p1', 'Chips Classic', 'CK-12'),
    product('p2', 'Chips Cheese', 'CK-13'),
    product('p3', 'Coffee', 'COF-1', 'sachet'),
    product('p4', 'Creamer', 'CRM-1', 'sachet'),
    product('p5', 'Rice', 'RICE', 'kg'),
  ];
});

test('lists the deals in plain words', () => {
  state.deals = [
    CHIPS,
    {
      ...CHIPS,
      id: 'b1',
      name: 'Coffee + creamer',
      kind: 'bundle',
      price: 20,
      setSize: null,
      productIds: ['p3', 'p4'],
      qtys: [1, 1],
      active: false,
    },
  ];
  render(<DealsSection />);
  const list = within(screen.getByRole('list', { name: 'Package deals' }));
  expect(list.getByText('3 for ₱100.00 · 2 products')).toBeInTheDocument();
  expect(list.getByText('1 Coffee + 1 Creamer for ₱20.00')).toBeInTheDocument();
  expect(
    within(list.getByRole('listitem', { name: 'Coffee + creamer' })).getByText('Off'),
  ).toBeVisible();
});

test('adds "any 3 chips for ₱100"; products sold by kg are not offered', async () => {
  render(<DealsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add deal' }));
  const form = within(screen.getByRole('form', { name: 'Add a deal' }));
  expect(form.queryByText('Rice · RICE')).toBeNull();
  await user.type(form.getByLabelText('Name'), 'Chips 3 for ₱100');
  await user.type(form.getByLabelText('Price of one set'), '100');
  await user.click(form.getByLabelText('Chips Classic · CK-12'));
  await user.click(form.getByLabelText('Chips Cheese · CK-13'));
  await user.click(form.getByRole('button', { name: 'Add deal' }));
  expect(createDeal).toHaveBeenCalledWith({
    name: 'Chips 3 for ₱100',
    kind: 'quantity',
    price: 100,
    set_size: 3,
    product_ids: ['p1', 'p2'],
    qtys: [],
  });
});

test('adds a bundle with a count for each item', async () => {
  render(<DealsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add deal' }));
  const form = within(screen.getByRole('form', { name: 'Add a deal' }));
  await user.click(form.getByRole('radio', { name: 'Bundle' }));
  expect(form.queryByLabelText('Units in a set')).toBeNull();
  await user.type(form.getByLabelText('Name'), 'Coffee + creamer');
  await user.type(form.getByLabelText('Price of one set'), '20');
  await user.click(form.getByLabelText('Coffee · COF-1'));
  await user.click(form.getByLabelText('Creamer · CRM-1'));
  await user.clear(form.getByLabelText('How many Creamer'));
  await user.type(form.getByLabelText('How many Creamer'), '2');
  await user.click(form.getByRole('button', { name: 'Add deal' }));
  expect(createDeal).toHaveBeenCalledWith({
    name: 'Coffee + creamer',
    kind: 'bundle',
    price: 20,
    set_size: null,
    product_ids: ['p3', 'p4'],
    qtys: [1, 2],
  });
});

test('checks the form before sending anything', async () => {
  render(<DealsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add deal' }));
  const form = within(screen.getByRole('form', { name: 'Add a deal' }));
  await user.clear(form.getByLabelText('Units in a set'));
  await user.type(form.getByLabelText('Units in a set'), '1');
  await user.click(form.getByRole('button', { name: 'Add deal' }));
  expect(form.getByText('Give the deal a name staff will recognise.')).toBeInTheDocument();
  expect(
    form.getByText('Enter the price of one set, for example 100 or 19.50.'),
  ).toBeInTheDocument();
  expect(form.getByText('A set is 2 to 100 units.')).toBeInTheDocument();
  expect(form.getByText('Choose at least one product.')).toBeInTheDocument();
  await user.click(form.getByRole('radio', { name: 'Bundle' }));
  await user.click(form.getByLabelText('Coffee · COF-1'));
  await user.click(form.getByRole('button', { name: 'Add deal' }));
  expect(form.getByText('A bundle has at least two different items.')).toBeInTheDocument();
  expect(createDeal).not.toHaveBeenCalled();
});

test('switches a deal off, and edits its price without changing its kind', async () => {
  state.deals = [CHIPS];
  render(<DealsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Switch off Chips 3 for ₱100' }));
  expect(updateDeal).toHaveBeenCalledWith('q1', { active: false });

  await user.click(screen.getByRole('button', { name: 'Edit Chips 3 for ₱100' }));
  const form = within(screen.getByRole('form', { name: 'Edit Chips 3 for ₱100' }));
  expect(form.queryByRole('radio', { name: 'Bundle' })).toBeNull();
  await user.clear(form.getByLabelText('Price of one set'));
  await user.type(form.getByLabelText('Price of one set'), '99');
  await user.click(form.getByRole('button', { name: 'Save deal' }));
  expect(updateDeal).toHaveBeenLastCalledWith('q1', {
    name: 'Chips 3 for ₱100',
    price: 99,
    set_size: 3,
    product_ids: ['p1', 'p2'],
    qtys: [],
  });
});

test('the audit log reads deals in plain words', () => {
  const entry = (action: string, before: unknown, after: unknown) =>
    ({
      id: 'a',
      action,
      before,
      after,
      reason: null,
      createdAt: new Date(),
    }) as unknown as AuditRecord;
  expect(
    describeAudit(
      entry('deal.create', null, {
        name: 'Chips 3 for ₱100',
        kind: 'quantity',
        price: 100,
        setSize: 3,
        productIds: ['p1'],
      }),
      '',
    ),
  ).toMatchObject({ what: 'added deal “Chips 3 for ₱100”', change: '3 for ₱100.00' });
  expect(
    describeAudit(entry('deal.update', { name: 'Coffee + creamer', price: 20 }, { price: 19 }), ''),
  ).toMatchObject({ what: 'changed deal “Coffee + creamer”', change: 'Price: ₱20.00 → ₱19.00' });
});
