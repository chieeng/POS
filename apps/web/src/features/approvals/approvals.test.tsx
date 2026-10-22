import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import type { Category, Product } from '@/features/catalog/data';
import type { AuditRecord, UserRecord } from '@/features/users/data';
import { useSession, type SessionUser } from '@/stores/session';
import { ApprovalsPage } from './ApprovalsPage';
import {
  decideApproval,
  describeApprovalError,
  isOutdated,
  requestProductChange,
  withdrawRequest,
  type ApprovalRequest,
} from './data';
import { MyRequestsPage } from './MyRequestsPage';
import { RequestChangePanel } from './RequestChangePanel';

const state = vi.hoisted(() => ({
  requests: [] as ApprovalRequest[],
  products: [] as Product[],
  categories: [] as Category[],
  users: [] as UserRecord[],
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  useApprovalRequests: () => ({ data: state.requests, loading: false, error: false }),
  requestProductChange: vi.fn(),
  withdrawRequest: vi.fn(),
  decideApproval: vi.fn(),
}));
vi.mock('@/features/catalog/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/data')>()),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
  useCategories: () => ({ data: state.categories, loading: false, error: false }),
}));
vi.mock('@/features/users/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/users/data')>()),
  useUsers: () => ({ data: state.users, loading: false, error: false }),
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
};

const request = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'r1',
  type: 'product_edit',
  productId: 'p1',
  before: { sell_price: 45 },
  after: { sell_price: 48.5 },
  reason: 'Supplier raised the price',
  requestedBy: 's1',
  status: 'pending',
  decidedBy: null,
  decidedAt: null,
  ownerNote: null,
  createdAt: new Date('2026-10-22T09:00:00+08:00'),
  ...overrides,
});

function signInAs(role: SessionUser['role']) {
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: role === 'owner' ? 'o1' : 's1',
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
  vi.mocked(requestProductChange).mockResolvedValue('r9');
  vi.mocked(withdrawRequest).mockResolvedValue(undefined);
  vi.mocked(decideApproval).mockResolvedValue(undefined);
  state.products = [CHIPS];
  state.categories = [
    { id: 'c1', name: 'Snacks', active: true },
    { id: 'c2', name: 'Drinks', active: true },
  ];
  state.users = [
    {
      uid: 's1',
      displayName: 'Maria Cruz',
      email: 'm@x.co',
      role: 'special_sales',
      userCode: 'MC',
      active: true,
    },
  ];
  state.requests = [request()];
  signInAs('owner');
});

describe('outdated (decision 3)', () => {
  test('a request is outdated once a requested field changed since', () => {
    expect(isOutdated(request(), CHIPS)).toBe(false);
    expect(isOutdated(request(), { ...CHIPS, sellPrice: 49 })).toBe(true);
    expect(isOutdated(request(), { ...CHIPS, name: 'Other name' })).toBe(false);
    expect(
      isOutdated(request({ before: { active: true }, after: { active: false } }), {
        ...CHIPS,
        active: false,
      }),
    ).toBe(true);
  });

  test('errors read as sentences', () => {
    expect(describeApprovalError({ message: 'request_outdated' })).toBe(
      'The product changed since this request was made, so it can only be rejected.',
    );
    expect(describeApprovalError({ message: 'request_pending' })).toMatch(
      /already have a pending request/,
    );
  });
});

describe('Approvals (Owner)', () => {
  test('shows a pending request: who, what changes, the reason', () => {
    renderPage(<ApprovalsPage />);
    expect(screen.getByText('Waiting for you · 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chips Classic' })).toBeInTheDocument();
    expect(screen.getByText(/Maria Cruz/)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Price/ });
    expect(within(row).getByText('₱45.00')).toBeInTheDocument();
    expect(within(row).getByText('₱48.50')).toBeInTheDocument();
    expect(screen.getByText('Supplier raised the price')).toBeInTheDocument();
  });

  test('approves with a note', async () => {
    const user = renderPage(<ApprovalsPage />);
    await user.click(screen.getByRole('button', { name: /Approve the request/ }));
    await user.type(screen.getByLabelText('Note (optional)'), 'OK');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(decideApproval).toHaveBeenCalledWith('r1', true, 'OK');
    expect(await screen.findByText('Approved: Chips Classic.')).toBeInTheDocument();
  });

  test('rejects', async () => {
    const user = renderPage(<ApprovalsPage />);
    await user.click(screen.getByRole('button', { name: /Reject the request/ }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(decideApproval).toHaveBeenCalledWith('r1', false, '');
  });

  test('an outdated request shows now and then, and can only be rejected', () => {
    state.products = [{ ...CHIPS, sellPrice: 49 }];
    renderPage(<ApprovalsPage />);
    expect(screen.getByText(/the product changed since this request/)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Price/ });
    expect(within(row).getByText('₱45.00')).toBeInTheDocument();
    expect(within(row).getByText('₱49.00')).toBeInTheDocument();
    expect(within(row).getByText('₱48.50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve the request/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reject the request/ })).toBeEnabled();
  });

  test('decided requests are listed with their status and note', () => {
    state.requests = [
      request({
        id: 'r2',
        status: 'rejected',
        decidedBy: 'o1',
        decidedAt: new Date(),
        ownerNote: 'Still selling',
      }),
    ];
    renderPage(<ApprovalsPage />);
    expect(screen.getByText('Nothing is waiting for your approval.')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Note: Still selling')).toBeInTheDocument();
  });
});

describe('My requests (APPR-05)', () => {
  beforeEach(() => signInAs('special_sales'));

  test('shows the status and the Owner’s note', () => {
    state.requests = [
      request({ status: 'approved', decidedBy: 'o1', decidedAt: new Date(), ownerNote: 'OK' }),
    ];
    renderPage(<MyRequestsPage />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  test('a pending request can be withdrawn (decision 2)', async () => {
    const user = renderPage(<MyRequestsPage />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(withdrawRequest).toHaveBeenCalledWith('r1');
    expect(await screen.findByText('Request withdrawn.')).toBeInTheDocument();
  });

  test('an outdated request says to make a new one', () => {
    state.products = [{ ...CHIPS, sellPrice: 49 }];
    renderPage(<MyRequestsPage />);
    expect(screen.getByText('Outdated')).toBeInTheDocument();
    expect(screen.getByText(/make a new one if the change is still needed/)).toBeInTheDocument();
  });
});

describe('Request a change (PROD-04)', () => {
  beforeEach(() => {
    signInAs('special_sales');
    state.requests = [];
  });

  const panel = () =>
    renderPage(<RequestChangePanel product={CHIPS} categories={state.categories} />);

  test('sends only what changed, with the reason', async () => {
    const user = panel();
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    const price = screen.getByLabelText('Selling price (₱)');
    await user.clear(price);
    await user.type(price, '48.50');
    await user.type(screen.getByLabelText('Reason for the Owner'), 'Supplier raised the price');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(requestProductChange).toHaveBeenCalledWith(
      'p1',
      { sell_price: 48.5 },
      'Supplier raised the price',
    );
    expect(await screen.findByText(/Request sent/)).toBeInTheDocument();
  });

  test('“Request sent” goes away once the request shows up (and so after it is decided)', async () => {
    vi.mocked(requestProductChange).mockResolvedValue('r9');
    const user = userEvent.setup();
    const { rerender } = render(
      <MemoryRouter>
        <RequestChangePanel product={CHIPS} categories={state.categories} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    await user.click(screen.getByLabelText('Deactivate this product'));
    await user.type(screen.getByLabelText('Reason for the Owner'), 'Discontinued');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/Request sent/)).toBeInTheDocument();

    state.requests = [
      request({ id: 'r9', status: 'rejected', decidedBy: 'o1', decidedAt: new Date() }),
    ];
    rerender(
      <MemoryRouter>
        <RequestChangePanel product={CHIPS} categories={state.categories} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Request sent/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Request a change' })).toBeInTheDocument();
  });

  test('asks to deactivate', async () => {
    const user = panel();
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    await user.click(screen.getByLabelText('Deactivate this product'));
    await user.type(screen.getByLabelText('Reason for the Owner'), 'Discontinued');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(requestProductChange).toHaveBeenCalledWith('p1', { active: false }, 'Discontinued');
  });

  test('needs a change and a reason', async () => {
    const user = panel();
    await user.click(screen.getByRole('button', { name: 'Request a change' }));
    await user.type(screen.getByLabelText('Reason for the Owner'), 'x');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(
      await screen.findByText('Change at least one thing, or close the form.'),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Reason for the Owner'));
    await user.click(screen.getByLabelText('Deactivate this product'));
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Give a reason for the Owner.')).toBeInTheDocument();
    expect(requestProductChange).not.toHaveBeenCalled();
  });

  test('with a pending request, shows it with Withdraw instead (decision 5)', async () => {
    state.requests = [request()];
    const user = panel();
    expect(screen.getByText('Your request is waiting for the Owner.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a change' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(withdrawRequest).toHaveBeenCalledWith('r1');
  });
});

describe('audit log', () => {
  test('request events read as sentences', () => {
    const entry: AuditRecord = {
      id: '1',
      action: 'approval.request',
      actorId: 's1',
      targetId: 'r1',
      deviceTag: null,
      before: null,
      after: { label: 'Chips Classic', changes: { sell_price: 48.5, active: false } },
      reason: 'Supplier raised the price',
      createdAt: null,
    };
    expect(describeAudit(entry, 'x')).toMatchObject({
      what: 'requested a change to “Chips Classic”',
      change: 'Price, Status · Supplier raised the price',
    });
    expect(describeAudit({ ...entry, action: 'approval.approve', reason: 'OK' }, 'x').what).toBe(
      'approved a request for “Chips Classic”',
    );
  });
});
