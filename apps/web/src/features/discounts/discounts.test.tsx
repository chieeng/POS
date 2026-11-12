import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import type { Category, Product } from '@/features/catalog/data';
import type { AuditRecord } from '@/features/users/data';
import { createDiscount, updateDiscount } from './data';
import { DiscountsSection } from './DiscountsSection';
import type { DiscountRule } from './rules';

const state = vi.hoisted(() => ({
  discounts: [] as DiscountRule[],
  categories: [] as Category[],
  products: [] as Product[],
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useDiscounts: () => ({ data: state.discounts, loading: false, error: false }),
  createDiscount: vi.fn(() => Promise.resolve('new')),
  updateDiscount: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/features/catalog/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/data')>()),
  useCategories: () => ({ data: state.categories, loading: false, error: false }),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
}));

const SUKI: DiscountRule = {
  id: 'd1',
  name: 'Suki 10%',
  kind: 'percent',
  value: 10,
  appliesTo: 'all',
  categoryIds: [],
  productIds: [],
  active: true,
};

const product = (id: string, name: string, sku: string): Product => ({
  id,
  sku,
  name,
  categoryId: 'c1',
  unit: 'pack',
  sellPrice: 45,
  stockQty: 10,
  reorderLevel: 0,
  active: true,
  photoKey: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.discounts = [];
  state.categories = [
    { id: 'c1', name: 'Snacks', active: true },
    { id: 'c2', name: 'Grains', active: true },
  ];
  state.products = [product('p1', 'Chips Classic', 'CK-12'), product('p2', 'Cola', 'COLA')];
});

test('lists the presets with their amount and what they apply to', () => {
  state.discounts = [
    SUKI,
    { ...SUKI, id: 'd2', name: 'Old promo', active: false },
    {
      ...SUKI,
      id: 'd3',
      name: '₱5 off chips',
      kind: 'fixed',
      value: 5,
      appliesTo: 'products',
      productIds: ['p1'],
    },
  ];
  render(<DiscountsSection />);
  const list = within(screen.getByRole('list', { name: 'Preset discounts' }));
  expect(list.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
    '₱5 off chips',
    'Suki 10%',
    'Old promo',
  ]);
  expect(list.getByText('₱5.00 off each · 1 product')).toBeInTheDocument();
  expect(
    within(list.getByRole('listitem', { name: 'Suki 10%' })).getByText('10% off · Every product'),
  ).toBeInTheDocument();
  expect(within(list.getByRole('listitem', { name: 'Old promo' })).getByText('Off')).toBeVisible();
});

test('adds 10% off every product', async () => {
  render(<DiscountsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add discount' }));
  const form = within(screen.getByRole('form', { name: 'Add a discount' }));
  await user.type(form.getByLabelText('Name'), 'Suki 10%');
  await user.type(form.getByLabelText('Percent off'), '10');
  await user.click(form.getByRole('button', { name: 'Add discount' }));
  expect(createDiscount).toHaveBeenCalledWith({
    name: 'Suki 10%',
    kind: 'percent',
    value: 10,
    applies_to: 'all',
    category_ids: [],
    product_ids: [],
  });
});

test('adds ₱5 off each unit of chosen products', async () => {
  render(<DiscountsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add discount' }));
  const form = within(screen.getByRole('form', { name: 'Add a discount' }));
  await user.type(form.getByLabelText('Name'), '₱5 off chips');
  await user.click(form.getByRole('radio', { name: '₱ off each unit' }));
  await user.type(form.getByLabelText('Pesos off each unit (each kg or L)'), '5');
  await user.click(form.getByRole('radio', { name: 'Products' }));
  await user.type(form.getByLabelText('Search products'), 'chips');
  expect(form.queryByText('Cola · COLA')).toBeNull();
  await user.click(form.getByLabelText('Chips Classic · CK-12'));
  expect(form.getByText('Products (1 chosen)')).toBeInTheDocument();
  await user.click(form.getByRole('button', { name: 'Add discount' }));
  expect(createDiscount).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'fixed',
      value: 5,
      applies_to: 'products',
      product_ids: ['p1'],
    }),
  );
});

test('checks the form before sending anything', async () => {
  render(<DiscountsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add discount' }));
  const form = within(screen.getByRole('form', { name: 'Add a discount' }));
  await user.type(form.getByLabelText('Percent off'), '120');
  await user.click(form.getByRole('radio', { name: 'Categories' }));
  await user.click(form.getByRole('button', { name: 'Add discount' }));
  expect(form.getByText('Give the discount a name staff will recognise.')).toBeInTheDocument();
  expect(form.getByText('Enter a percent from 0.01 to 100.')).toBeInTheDocument();
  expect(form.getByText('Choose at least one category.')).toBeInTheDocument();
  await user.clear(form.getByLabelText('Percent off'));
  await user.type(form.getByLabelText('Percent off'), '2.555');
  await user.click(form.getByRole('button', { name: 'Add discount' }));
  expect(form.getByText('Enter a percent from 0.01 to 100.')).toBeInTheDocument();
  expect(createDiscount).not.toHaveBeenCalled();
});

test('switches a preset off and edits it', async () => {
  state.discounts = [SUKI];
  render(<DiscountsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Switch off Suki 10%' }));
  expect(updateDiscount).toHaveBeenCalledWith('d1', { active: false });

  await user.click(screen.getByRole('button', { name: 'Edit Suki 10%' }));
  const form = within(screen.getByRole('form', { name: 'Edit Suki 10%' }));
  await user.click(form.getByRole('radio', { name: 'Categories' }));
  await user.click(form.getByLabelText('Snacks'));
  await user.click(form.getByRole('button', { name: 'Save discount' }));
  expect(updateDiscount).toHaveBeenLastCalledWith('d1', {
    name: 'Suki 10%',
    kind: 'percent',
    value: 10,
    applies_to: 'categories',
    category_ids: ['c1'],
    product_ids: [],
  });
});

test('the audit log reads presets in plain words', () => {
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
      entry('discount.create', null, {
        name: 'Suki 10%',
        kind: 'percent',
        value: 10,
        appliesTo: 'all',
      }),
      '',
    ),
  ).toMatchObject({ what: 'added discount “Suki 10%”', change: '10% off · Every product' });
  expect(
    describeAudit(
      entry('discount.update', { name: 'Suki 10%', active: true }, { active: false }),
      '',
    ),
  ).toMatchObject({ what: 'switched off discount “Suki 10%”' });
  expect(
    describeAudit(
      entry(
        'discount.update',
        { name: 'Promo', kind: 'percent', value: 10 },
        { kind: 'fixed', value: 5 },
      ),
      '',
    ),
  ).toMatchObject({ what: 'changed discount “Promo”', change: 'Amount: 10% off → ₱5.00 off each' });
});
