import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Product } from '@/features/catalog/data';
import type { BranchSettings, PaymentAccount } from '@/features/store/data';
import { BranchContext } from '@/features/store/data';
import { addToOutbox, watchOutboxItem } from '@/lib/outbox';
import { useSession } from '@/stores/session';
import { useCart } from './cart';
import {
  checkout,
  CheckoutError,
  DEFAULT_SETTINGS,
  referenceUsedOnDevice,
  rememberedSettings,
  rememberSettings,
  settingsFrom,
  type CheckoutSettings,
} from './checkout';
import { completeSale } from './data';
import { SellPage } from './SellPage';
import { quickCash } from './totals';

const state = vi.hoisted(() => ({
  products: [] as Product[],
  accounts: [] as PaymentAccount[],
}));

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('@/lib/device', () => ({ getDeviceTag: () => 'A1B2' }));
vi.mock('@/lib/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/outbox')>()),
  addToOutbox: vi.fn(),
  watchOutboxItem: vi.fn(() => () => undefined),
}));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  completeSale: vi.fn(),
}));
vi.mock('@/features/catalog/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/data')>()),
  useProducts: () => ({ data: state.products, loading: false, error: false }),
  useCategories: () => ({ data: [], loading: false, error: false }),
}));
vi.mock('@/features/store/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/store/data')>()),
  usePaymentAccounts: () => ({ data: state.accounts, loading: false, error: false }),
}));
vi.mock('@/features/drawer/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/drawer/data')>()),
  useDrawerToday: () => ({ data: null, loading: false, error: false, reload: () => {} }),
}));

const RICE: Product = {
  id: 'p2',
  sku: 'RICE',
  name: 'Rice',
  categoryId: 'c1',
  unit: 'kg',
  sellPrice: 99,
  stockQty: 10,
  reorderLevel: 0,
  active: true,
  photoKey: null,
};
const CHIPS: Product = {
  ...RICE,
  id: 'p1',
  sku: 'CK-12',
  name: 'Chips Classic',
  unit: 'pack',
  sellPrice: 45,
};

const BRANCH: BranchSettings = {
  id: 'main',
  name: 'Eragon Store',
  address: '12 Rizal St.',
  contact: '0917 000 0000',
  tin: null,
  receiptFooter: 'Salamat po!',
  vatRegistered: false,
  vatRate: 12,
  roundCash: true,
  idleLockMinutes: 15,
  storeLat: null,
  storeLng: null,
  radiusM: 100,
  morningClockIn: '06:00',
  afternoonClockIn: '13:00',
  graceMinutes: 15,
  lateDeduction: 'none',
  latePenalty: 0,
  paidMinutesPerDay: 480,
  afternoonDayCredit: 0.5,
  ownerClocksIn: false,
};

const GCASH: PaymentAccount = {
  id: 'a1',
  provider: 'gcash',
  label: 'Main GCash',
  number: '0917 123 4567',
  active: true,
};

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function renderSell(branch: BranchSettings = BRANCH) {
  render(
    <MemoryRouter>
      <BranchContext.Provider value={{ data: [branch], loading: false, error: false }}>
        <SellPage />
      </BranchContext.Provider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

/** 1.25 kg of rice: ₱123.75, charged ₱124.00 in cash. */
async function cartWithRice(user: ReturnType<typeof userEvent.setup>) {
  act(() => useCart.getState().add('u1', RICE, 1.25));
  await user.click(screen.getByRole('button', { name: 'Pay ₱123.75' }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  useCart.setState({ uid: null, lines: [] });
  state.products = [RICE, CHIPS];
  state.accounts = [];
  setOnline(true);
  vi.mocked(completeSale).mockResolvedValue({} as never);
  vi.mocked(addToOutbox).mockResolvedValue();
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: 'u1',
      email: 'u@x.co',
      displayName: 'Test Two',
      role: 'sales',
      branchId: 'main',
      secondFactor: false,
      userCode: 'TT',
    },
  });
});

describe('cash (POS-04)', () => {
  test('quick amounts: exact, then round amounts above it', () => {
    expect(quickCash(311)).toEqual([311, 320, 350, 400, 500, 1000]);
    expect(quickCash(124)).toEqual([124, 140, 150, 200, 500, 1000]);
    expect(quickCash(0)).toEqual([]);
  });

  test('₱123.75 is charged ₱124.00; change shows as you type; the slip shows the rounding', async () => {
    const user = renderSell();
    const sheet = await cartWithRice(user);
    expect(within(sheet).getByLabelText('Total to pay ₱124.00')).toBeInTheDocument();
    expect(within(sheet).getByText('₱123.75 rounded to the peso for cash')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '₱500' }));
    expect(within(sheet).getByLabelText('Change')).toHaveTextContent('₱376.00');
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));

    expect(completeSale).toHaveBeenCalledWith(
      expect.objectContaining({
        receipt_no: expect.stringMatching(/^TT-\d{8}-A1B2-1$/),
        offline: false,
        round_cash: true,
        vat_rate: null,
        total: 124,
        lines: [{ product_id: 'p2', qty: 1.25, unit_price: 99 }],
        payments: [{ method: 'cash', amount: 500 }],
      }),
    );
    const slip = await screen.findByRole('article', { name: /^Slip TT-/ });
    expect(screen.getByText('₱376.00', { selector: 'b' })).toBeInTheDocument();
    // The receipt number has a line of its own and never wraps (reviewer, Nov 8).
    expect(within(slip).getByText(/^Receipt TT-\d{8}-A1B2-1$/)).toHaveClass('whitespace-nowrap');
    for (const text of [
      'Eragon Store',
      '12 Rizal St.',
      '1.25 kg × ₱99.00',
      'Rounding',
      '+₱0.25',
      'Salesperson: Test Two',
      'Salamat po!',
      'This is not an official receipt',
    ]) {
      expect(within(slip).getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /Share|Print/ })).toBeNull();
    expect(useCart.getState().lines).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'New sale' }));
    expect(screen.getByLabelText('Search name or SKU')).toBeInTheDocument();
  });

  test('not enough cash is refused before anything is sent', async () => {
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.type(within(sheet).getByLabelText('Amount received'), '100');
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(
      within(sheet).getByText('Enter the cash received: at least ₱124.00.'),
    ).toBeInTheDocument();
    expect(completeSale).not.toHaveBeenCalled();
  });

  test('with rounding off, cash is exact; with VAT on, the slip shows the VAT part (POS-07)', async () => {
    const user = renderSell({ ...BRANCH, roundCash: false, vatRegistered: true, vatRate: 12 });
    const sheet = await cartWithRice(user);
    expect(within(sheet).getByLabelText('Total to pay ₱123.75')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Exact' }));
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(completeSale).toHaveBeenCalledWith(
      expect.objectContaining({ round_cash: false, vat_rate: 12, total: 123.75 }),
    );
    const slip = await screen.findByRole('article', { name: /^Slip / });
    expect(within(slip).getByText('VAT 12% included')).toBeInTheDocument();
    expect(within(slip).getByText('₱13.26')).toBeInTheDocument();
    expect(within(slip).queryByText('Rounding')).toBeNull();
  });
});

describe('GCash and Maya (POS-04, POS-13)', () => {
  test('exact amount, reference required, one account picked automatically', async () => {
    state.accounts = [GCASH];
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.click(within(sheet).getByRole('radio', { name: 'GCash' }));
    expect(within(sheet).getByLabelText('Total to pay ₱123.75')).toBeInTheDocument();
    expect(within(sheet).getByText('To Main GCash · 0917 123 4567')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(
      within(sheet).getByText("Enter the GCash reference number from the customer's screen."),
    ).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText(/GCash reference no/), '1012 345 678');
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(completeSale).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 123.75,
        payments: [{ method: 'gcash', amount: 123.75, reference: '1012345678', account_id: 'a1' }],
      }),
    );
    const slip = await screen.findByRole('article', { name: /^Slip / });
    expect(within(slip).getByText('GCash · Main GCash · Ref 1012345678')).toBeInTheDocument();
    expect(referenceUsedOnDevice('gcash', '1012345678')).toMatch(/^TT-/);
  });

  test('with several accounts, staff pick one', async () => {
    state.accounts = [
      GCASH,
      { ...GCASH, id: 'a2', label: 'Second GCash', number: '0918 222 3333' },
    ];
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.click(within(sheet).getByRole('radio', { name: 'GCash' }));
    await user.type(within(sheet).getByLabelText(/GCash reference no/), 'AB1234');
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(
      within(sheet).getByText('Choose which GCash account the customer paid.'),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('radio', { name: /Second GCash/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(completeSale).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [expect.objectContaining({ account_id: 'a2', reference: 'AB1234' })],
      }),
    );
  });

  test('a reference used before on this phone is caught at once, even offline', async () => {
    localStorage.setItem(
      'pos.usedReferences',
      JSON.stringify([{ method: 'maya', reference: 'MY7788', receiptNo: 'TT-20261107-A1B2-3' }]),
    );
    setOnline(false);
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.click(within(sheet).getByRole('radio', { name: 'Maya' }));
    await user.type(within(sheet).getByLabelText(/Maya reference no/), 'my 7788');
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(
      within(sheet).getByText(
        "This reference was already used on receipt TT-20261107-A1B2-3. Check the customer's Maya screen and type it again.",
      ),
    ).toBeInTheDocument();
    expect(addToOutbox).not.toHaveBeenCalled();
  });

  test('online, the server finds it on another sale: shown at the field, the cart is kept', async () => {
    vi.mocked(completeSale).mockRejectedValue({
      code: 'P0001',
      message: 'duplicate_reference',
      details: '1012345678',
    });
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.click(within(sheet).getByRole('radio', { name: 'GCash' }));
    await user.type(within(sheet).getByLabelText(/GCash reference no/), '1012345678');
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(
      await within(sheet).findByText(
        "Reference 1012345678 is already on another sale. Check the number on the customer's phone.",
      ),
    ).toBeInTheDocument();
    expect(useCart.getState().lines).toHaveLength(1);
    expect(addToOutbox).not.toHaveBeenCalled();
  });
});

describe('split (POS-04)', () => {
  test('Maya ₱50 and the rest in cash, rounded; covered, then completed', async () => {
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.click(within(sheet).getByRole('radio', { name: 'Split' }));
    await user.selectOptions(within(sheet).getByLabelText('Method, line 2'), 'maya');
    await user.type(within(sheet).getByLabelText('Amount, line 2'), '50');
    await user.type(within(sheet).getByLabelText(/Maya reference no/), 'MY-7788');
    expect(within(sheet).getByRole('status')).toHaveTextContent('Remaining₱74.00');
    await user.type(within(sheet).getByLabelText('Amount, line 1'), '100');
    expect(within(sheet).getByRole('status')).toHaveTextContent('Fully covered');
    expect(within(sheet).getByRole('status')).toHaveTextContent('Change ₱26.00');
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(completeSale).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 124,
        payments: [
          { method: 'cash', amount: 100 },
          { method: 'maya', amount: 50, reference: 'MY-7788', account_id: null },
        ],
      }),
    );
  });
});

describe('offline and lost connections (NFR-02, POS-06)', () => {
  test('offline, the sale waits on the phone and the slip says so', async () => {
    setOnline(false);
    const user = renderSell();
    const sheet = await cartWithRice(user);
    expect(within(sheet).getByText(/Offline: the sale is kept on this phone/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Exact' }));
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(completeSale).not.toHaveBeenCalled();
    expect(addToOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sale',
        uid: 'u1',
        payload: expect.objectContaining({ offline: true, total: 124 }),
      }),
    );
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();
  });

  test('once the outbox sends it, the slip says it was sent; a refusal says so too', async () => {
    setOnline(false);
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.click(within(sheet).getByRole('button', { name: 'Exact' }));
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();

    const saleId = vi.mocked(addToOutbox).mock.calls[0]![0].id;
    const [watchedId, report] = vi.mocked(watchOutboxItem).mock.calls.at(-1)!;
    expect(watchedId).toBe(saleId);

    act(() => report({ status: 'needsAttention', error: 'Reference already used.' }));
    expect(screen.getByText('The store refused this sale.')).toBeInTheDocument();
    expect(screen.getByText(/Reference already used\./)).toBeInTheDocument();

    act(() => report(null));
    expect(screen.getByText('Sent to the store.')).toBeInTheDocument();
    expect(screen.queryByText(/Saved on this phone/)).toBeNull();
    expect(screen.queryByText(/don.t sign out/)).toBeNull();
  });

  test('a sale sent at once has no note and does not watch the outbox', async () => {
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.click(within(sheet).getByRole('button', { name: 'Exact' }));
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    await screen.findByRole('article', { name: /^Slip TT-/ });
    expect(screen.queryByText(/Saved on this phone|Sent to the store/)).toBeNull();
    expect(watchOutboxItem).not.toHaveBeenCalled();
  });

  test('the connection drops while sending: kept in the outbox with the same id', async () => {
    vi.mocked(completeSale).mockRejectedValue(new TypeError('Failed to fetch'));
    const user = renderSell();
    const sheet = await cartWithRice(user);
    await user.click(within(sheet).getByRole('button', { name: 'Exact' }));
    await user.click(within(sheet).getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();
    const sent = vi.mocked(completeSale).mock.calls[0]![0];
    expect(addToOutbox).toHaveBeenCalledWith(expect.objectContaining({ id: sent.id }));
  });
});

describe('checkout settings and refusals', () => {
  test('the store settings are remembered for offline sales; defaults: round cash, no VAT', () => {
    expect(rememberedSettings()).toEqual(DEFAULT_SETTINGS);
    const settings = settingsFrom({ ...BRANCH, vatRegistered: true }, [
      GCASH,
      { ...GCASH, id: 'x', active: false },
    ]);
    expect(settings).toMatchObject({ vatRate: 12, roundCash: true, accounts: [{ id: 'a1' }] });
    rememberSettings(settings);
    expect(rememberedSettings()).toEqual(settings);
  });

  test('without a user code the device cannot number receipts yet', async () => {
    const settings: CheckoutSettings = DEFAULT_SETTINGS;
    await expect(
      checkout({
        uid: 'u1',
        branchId: 'main',
        userCode: undefined,
        salesperson: 'X',
        settings,
        lines: [{ product: CHIPS, qty: 1 }],
        payments: [{ method: 'cash', amount: 45 }],
        online: true,
      }),
    ).rejects.toEqual(new CheckoutError('no_user_code'));
  });
});
