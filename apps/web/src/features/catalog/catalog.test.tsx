import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import type { AuditRecord } from '@/features/users/data';
import { useSession, type SessionUser } from '@/stores/session';
import { CategoriesPage } from './CategoriesPage';
import {
  createCategory,
  createSupplier,
  sortByActiveThenName,
  updateCategory,
  updateSupplier,
  type Category,
  type Supplier,
} from './data';
import { SuppliersPage } from './SuppliersPage';

const state = vi.hoisted(() => ({
  categories: [] as Category[],
  suppliers: [] as Supplier[],
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useCategories: () => ({ data: state.categories, loading: false, error: false }),
  useSuppliers: () => ({ data: state.suppliers, loading: false, error: false }),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));

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

function renderPage(page: React.ReactNode) {
  render(<MemoryRouter>{page}</MemoryRouter>);
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createCategory).mockResolvedValue();
  vi.mocked(updateCategory).mockResolvedValue();
  vi.mocked(createSupplier).mockResolvedValue();
  vi.mocked(updateSupplier).mockResolvedValue();
  state.categories = [
    { id: 'c2', name: 'snacks', active: true },
    { id: 'c3', name: 'Old stock', active: false },
    { id: 'c1', name: 'Drinks', active: true },
  ];
  state.suppliers = [
    {
      id: 's1',
      name: 'ABC Trading',
      contactPerson: 'Ana',
      phone: '0917 123 4567',
      address: null,
      active: true,
    },
  ];
  signInAs('owner');
});

test('active entries come first, then by name whatever the case', () => {
  expect(sortByActiveThenName(state.categories).map((c) => c.name)).toEqual([
    'Drinks',
    'snacks',
    'Old stock',
  ]);
});

describe('Products > Categories (PROD-03)', () => {
  test('lists categories, inactive ones marked', () => {
    renderPage(<CategoriesPage />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Drinks'),
      expect.stringContaining('snacks'),
      expect.stringContaining('Old stock'),
    ]);
    expect(within(items[2]!).getByText('Inactive')).toBeInTheDocument();
  });

  test.each(['owner', 'special_sales'] as const)('%s adds a category, trimmed', async (role) => {
    signInAs(role);
    const user = renderPage(<CategoriesPage />);
    await user.type(screen.getByLabelText('New category'), '  Frozen  ');
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    expect(createCategory).toHaveBeenCalledWith('Frozen');
    expect(await screen.findByText('Added “Frozen”.')).toBeInTheDocument();
  });

  test('an empty name is refused before anything is sent', async () => {
    const user = renderPage(<CategoriesPage />);
    await user.type(screen.getByLabelText('New category'), '   ');
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    expect(createCategory).not.toHaveBeenCalled();
  });

  test('a name already used says so', async () => {
    vi.mocked(createCategory).mockRejectedValue({ code: '23505', message: 'name_taken' });
    const user = renderPage(<CategoriesPage />);
    await user.type(screen.getByLabelText('New category'), 'drinks');
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    expect(
      await screen.findByText(
        'A category with this name already exists. If it is inactive, reactivate it instead.',
      ),
    ).toBeInTheDocument();
  });

  test('Special Sales cannot rename or deactivate, and is told to ask the Owner', () => {
    signInAs('special_sales');
    renderPage(<CategoriesPage />);
    expect(
      screen.getByText('To rename or deactivate a category, ask the Owner.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Deactivate/ })).toBeNull();
  });

  test('the Owner renames a category', async () => {
    const user = renderPage(<CategoriesPage />);
    await user.click(screen.getByRole('button', { name: 'Rename Drinks' }));
    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.type(field, ' Beverages ');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(updateCategory).toHaveBeenCalledWith('c1', { name: 'Beverages' });
    expect(await screen.findByText('Renamed to “Beverages”.')).toBeInTheDocument();
  });

  test('the Owner deactivates and reactivates after confirming', async () => {
    const user = renderPage(<CategoriesPage />);
    await user.click(screen.getByRole('button', { name: 'Deactivate Drinks' }));
    expect(screen.getByText(/can no longer be chosen for a new product/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(updateCategory).toHaveBeenCalledWith('c1', { active: false });

    await user.click(screen.getByRole('button', { name: 'Reactivate Old stock' }));
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));
    expect(updateCategory).toHaveBeenCalledWith('c3', { active: true });
  });
});

describe('Products > Suppliers (PROD-03)', () => {
  test('lists suppliers with their contact', () => {
    renderPage(<SuppliersPage />);
    expect(screen.getByText('ABC Trading')).toBeInTheDocument();
    expect(screen.getByText('Ana · 0917 123 4567')).toBeInTheDocument();
  });

  test.each(['owner', 'special_sales'] as const)('%s adds a supplier', async (role) => {
    signInAs(role);
    const user = renderPage(<SuppliersPage />);
    await user.click(screen.getByRole('button', { name: 'New supplier' }));
    await user.type(screen.getByLabelText('Supplier name'), 'XYZ Foods');
    await user.type(screen.getByLabelText(/Phone/), '0918 000 0000');
    await user.click(screen.getByRole('button', { name: 'Add supplier' }));
    expect(createSupplier).toHaveBeenCalledWith({
      name: 'XYZ Foods',
      contact_person: '',
      phone: '0918 000 0000',
      address: '',
    });
    expect(await screen.findByText('Added “XYZ Foods”.')).toBeInTheDocument();
  });

  test('a supplier needs a name', async () => {
    const user = renderPage(<SuppliersPage />);
    await user.click(screen.getByRole('button', { name: 'New supplier' }));
    await user.click(screen.getByRole('button', { name: 'Add supplier' }));
    expect(screen.getByText('Enter the supplier name.')).toBeInTheDocument();
    expect(createSupplier).not.toHaveBeenCalled();
  });

  test('Special Sales cannot edit a supplier', () => {
    signInAs('special_sales');
    renderPage(<SuppliersPage />);
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(
      screen.getByText('To change or deactivate a supplier, ask the Owner.'),
    ).toBeInTheDocument();
  });

  test('the Owner edits and deactivates a supplier', async () => {
    const user = renderPage(<SuppliersPage />);
    await user.click(screen.getByRole('button', { name: 'Edit ABC Trading' }));
    const phone = screen.getByLabelText(/Phone/);
    await user.clear(phone);
    await user.type(phone, '0918 765 4321');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateSupplier).toHaveBeenCalledWith('s1', {
      name: 'ABC Trading',
      contact_person: 'Ana',
      phone: '0918 765 4321',
      address: '',
    });

    await user.click(screen.getByRole('button', { name: 'Edit ABC Trading' }));
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(updateSupplier).toHaveBeenCalledWith('s1', { active: false });
  });
});

describe('audit log', () => {
  const entry = (overrides: Partial<AuditRecord>): AuditRecord => ({
    id: '1',
    action: '',
    actorId: 'o1',
    targetId: 'c1',
    deviceTag: null,
    before: null,
    after: null,
    reason: null,
    createdAt: null,
    ...overrides,
  });

  test('catalog entries read as sentences', () => {
    expect(
      describeAudit(entry({ action: 'category.create', after: { name: 'Snacks' } }), 'x').what,
    ).toBe('added category “Snacks”');
    expect(
      describeAudit(
        entry({
          action: 'category.update',
          before: { name: 'Drinks', label: 'Drinks' },
          after: { name: 'Beverages' },
        }),
        'x',
      ),
    ).toMatchObject({ what: 'changed category “Drinks”', change: 'Name: Drinks → Beverages' });
    expect(
      describeAudit(
        entry({
          action: 'supplier.update',
          before: { active: true, label: 'ABC Trading' },
          after: { active: false },
        }),
        'x',
      ).what,
    ).toBe('deactivated supplier “ABC Trading”');
    expect(
      describeAudit(
        entry({
          action: 'supplier.update',
          before: { phone: '0917', active: true, label: 'ABC Trading' },
          after: { phone: '0918', active: false },
        }),
        'x',
      ),
    ).toMatchObject({
      what: 'changed supplier “ABC Trading”',
      change: 'Phone: 0917 → 0918 · Deactivated',
    });
  });
});
