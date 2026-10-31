import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ApprovalRequest } from '@/features/approvals/data';
import { RequestChangePanel } from '@/features/approvals/RequestChangePanel';
import { describeAudit } from '@/features/audit/describe';
import type { AuditRecord } from '@/features/users/data';
import { useSession, type SessionUser } from '@/stores/session';
import { AddProductPage } from './AddProductPage';
import { createProduct, type Category, type Product } from './data';
import { csvCell, exportFileName, productsCsv } from './export';
import { PhotoPanel } from './PhotoPanel';
import {
  deletePhotoFiles,
  describePhotoError,
  removeProductPhoto,
  replaceProductPhoto,
  uploadPhoto,
} from './photos';
import { ProductPhoto } from './ProductPhoto';
import { ProductsPage } from './ProductsPage';

const state = vi.hoisted(() => ({
  requests: [] as ApprovalRequest[],
  products: [] as Product[],
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('./photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./photos')>()),
  photoUrl: (productId: string, key: string, size: number) =>
    `https://x.supabase.co/${productId}/${key}-${size}.jpg`,
  uploadPhoto: vi.fn(),
  deletePhotoFiles: vi.fn(),
  replaceProductPhoto: vi.fn(),
  removeProductPhoto: vi.fn(),
}));
vi.mock('@/features/approvals/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/approvals/data')>()),
  useApprovalRequests: () => ({ data: state.requests, loading: false, error: false }),
  requestProductChange: vi.fn(() => Promise.resolve('q1')),
  withdrawRequest: vi.fn(() => Promise.resolve()),
}));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useCategories: () => ({ data: CATEGORIES, loading: false, error: false }),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
  createProduct: vi.fn(),
}));

const CATEGORIES: Category[] = [{ id: 'c1', name: 'Snacks', active: true }];

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
const KEY = '11111111-1111-4111-8111-111111111111';
const WITH_PHOTO: Product = { ...CHIPS, photoKey: KEY };

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

const file = () => new File(['x'], 'chips.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(replaceProductPhoto).mockResolvedValue();
  vi.mocked(removeProductPhoto).mockResolvedValue();
  vi.mocked(uploadPhoto).mockResolvedValue('22222222-2222-4222-8222-222222222222');
  vi.mocked(deletePhotoFiles).mockResolvedValue();
  vi.mocked(createProduct).mockResolvedValue('p9');
  state.requests = [];
  state.products = [CHIPS];
  signInAs('owner');
});

describe('ProductPhoto', () => {
  test('shows the photo when there is one', () => {
    render(<ProductPhoto productId="p1" photoKey={KEY} size={200} alt="Photo" />);
    expect(screen.getByRole('img', { name: 'Photo' })).toHaveAttribute(
      'src',
      `https://x.supabase.co/p1/${KEY}-200.jpg`,
    );
  });

  test('a plain icon when there is none', () => {
    const { container } = render(<ProductPhoto productId="p1" photoKey={null} size={200} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('Photo on the product page (PROD-07)', () => {
  const panel = (product: Product, role: SessionUser['role']) => {
    render(<PhotoPanel product={product} role={role} />);
    return userEvent.setup();
  };

  test('the Owner adds a photo', async () => {
    const user = panel(CHIPS, 'owner');
    await user.upload(screen.getByLabelText('Add photo'), file());
    expect(replaceProductPhoto).toHaveBeenCalledWith('p1', expect.any(File), null);
    expect(await screen.findByText('Photo added.')).toBeInTheDocument();
  });

  test('the Owner replaces and removes a photo', async () => {
    const user = panel(WITH_PHOTO, 'owner');
    await user.upload(screen.getByLabelText('Replace photo'), file());
    expect(replaceProductPhoto).toHaveBeenCalledWith('p1', expect.any(File), KEY);
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(removeProductPhoto).toHaveBeenCalledWith('p1', KEY);
  });

  test('Special Sales adds a photo only to a product without one', () => {
    panel(CHIPS, 'special_sales');
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument();
  });

  test('Special Sales cannot replace or remove it directly', () => {
    panel(WITH_PHOTO, 'special_sales');
    expect(screen.queryByRole('button', { name: 'Replace photo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Photo of Chips Classic' })).toBeInTheDocument();
  });

  test('Sales see the photo only', () => {
    panel(WITH_PHOTO, 'sales');
    expect(screen.getByRole('img', { name: 'Photo of Chips Classic' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('errors read as sentences', () => {
    expect(describePhotoError(new Error('photo_unreadable'))).toBe(
      'This photo couldn’t be read. Try a JPEG or PNG photo.',
    );
    expect(describePhotoError({ code: '42501' })).toMatch(/Request a change/);
  });
});

describe('Requests with a photo', () => {
  const panel = () => {
    signInAs('special_sales');
    render(
      <MemoryRouter>
        <RequestChangePanel product={WITH_PHOTO} categories={CATEGORIES} />
      </MemoryRouter>,
    );
    return userEvent.setup();
  };

  test('Special Sales asks to replace the photo: it is uploaded, then requested', async () => {
    const { requestProductChange } = await import('@/features/approvals/data');
    const user = panel();
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    await user.click(screen.getByLabelText('Replace the photo'));
    await user.upload(screen.getByLabelText('New photo'), file());
    await user.type(screen.getByLabelText('Reason for the Owner'), 'Better photo');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(uploadPhoto).toHaveBeenCalledWith('p1', expect.any(File));
    expect(requestProductChange).toHaveBeenCalledWith(
      'p1',
      { photo_key: '22222222-2222-4222-8222-222222222222' },
      'Better photo',
    );
  });

  test('asking to replace without choosing a photo is explained', async () => {
    const user = panel();
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    await user.click(screen.getByLabelText('Replace the photo'));
    await user.type(screen.getByLabelText('Reason for the Owner'), 'Better photo');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText('Choose the new photo, or keep the current one.')).toBeInTheDocument();
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  test('asking to remove it sends no file', async () => {
    const { requestProductChange } = await import('@/features/approvals/data');
    const user = panel();
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    await user.click(screen.getByLabelText('Remove the photo'));
    await user.type(screen.getByLabelText('Reason for the Owner'), 'Wrong product');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(requestProductChange).toHaveBeenCalledWith('p1', { photo_key: null }, 'Wrong product');
  });

  test('a withdrawn photo request deletes the uploaded photo', async () => {
    state.requests = [
      {
        id: 'q1',
        type: 'product_edit',
        targetId: 'p1',
        productId: 'p1',
        before: { photo_key: KEY },
        after: { photo_key: '22222222-2222-4222-8222-222222222222' },
        reason: 'Better photo',
        requestedBy: 'u1',
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        ownerNote: null,
        createdAt: new Date(),
      },
    ];
    const user = panel();
    expect(screen.getAllByRole('img', { name: 'Photo' })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(deletePhotoFiles).toHaveBeenCalledWith('p1', '22222222-2222-4222-8222-222222222222');
  });
});

describe('Add product with a photo', () => {
  test('the photo is saved once the product exists', async () => {
    const router = createMemoryRouter(
      [
        { path: '/products/new', element: <AddProductPage /> },
        { path: '/products/:productId', element: <p>Product page</p> },
      ],
      { initialEntries: ['/products/new'] },
    );
    render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('SKU'), 'NEW-1');
    await user.type(screen.getByLabelText('Product name'), 'New snack');
    await user.selectOptions(screen.getByLabelText('Category'), 'c1');
    await user.type(screen.getByLabelText('Selling price (₱)'), '20');
    await user.upload(screen.getByLabelText('Photo (optional)'), file());
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(await screen.findByText('Product page')).toBeInTheDocument();
    expect(replaceProductPhoto).toHaveBeenCalledWith('p9', expect.any(File), null);
  });
});

describe('CSV export (PROD-06)', () => {
  test('opens in Excel: BOM, headers, plain numbers, text kept as typed', () => {
    const csv = productsCsv(
      [
        { ...CHIPS, name: 'Piña "Tropical", 1 L', sellPrice: 1250.5, stockQty: 7 },
        { ...CHIPS, id: 'p2', sku: '00123', name: '=HYPERLINK("x")', active: false },
      ],
      CATEGORIES,
      new Map([['p1', 30.1235]]),
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      'SKU,Name,Category,Unit,Price,Reorder level,Active,Stock on hand,Average cost',
    );
    expect(lines[1]).toBe('CK-12,"Piña ""Tropical"", 1 L",Snacks,pack,1250.50,0,Yes,7,30.1235');
    expect(lines[2]).toBe('"=""00123""","\'=HYPERLINK(""x"")",Snacks,pack,45.00,0,No,10,');
    expect(lines[3]).toBe('');
  });

  test('one field', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
    expect(csvCell('+63 912')).toBe("'+63 912");
  });

  test('the file is named after the day in Manila', () => {
    expect(exportFileName(new Date('2026-10-27T17:00:00Z'))).toBe('products-2026-10-28.csv');
  });

  test('only the Owner sees Export CSV', () => {
    const view = () =>
      render(
        <MemoryRouter>
          <ProductsPage />
        </MemoryRouter>,
      );
    const { unmount } = view();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    unmount();
    signInAs('special_sales');
    view();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  });
});

describe('audit log', () => {
  const entry = (overrides: Partial<AuditRecord>): AuditRecord => ({
    id: '1',
    action: 'product.update',
    actorId: 'o1',
    targetId: 'p1',
    deviceTag: null,
    before: null,
    after: null,
    reason: null,
    createdAt: null,
    ...overrides,
  });

  test('photo changes and exports read as sentences', () => {
    expect(
      describeAudit(
        entry({ before: { label: 'Chips', photo_key: null }, after: { photo_key: KEY } }),
        'x',
      ).change,
    ).toBe('Photo added');
    expect(
      describeAudit(
        entry({ before: { label: 'Chips', photo_key: KEY }, after: { photo_key: null } }),
        'x',
      ).change,
    ).toBe('Photo removed');
    expect(
      describeAudit(
        entry({
          action: 'approval.request',
          after: {
            label: 'Chips',
            before: { photo_key: KEY },
            changes: { photo_key: '22222222-2222-4222-8222-222222222222' },
          },
          reason: 'Better',
        }),
        'x',
      ).change,
    ).toBe('Replace the photo · Better');
    expect(
      describeAudit(entry({ action: 'products.export', after: { rows: 512 } }), 'x'),
    ).toMatchObject({ what: 'exported the product list (CSV)', change: '512 products' });
  });
});
