import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import type { AuditRecord } from '@/features/users/data';
import { vatPart } from '@/lib/money';
import {
  BranchContext,
  createPaymentAccount,
  toBranch,
  updateBranchSettings,
  updatePaymentAccount,
  type BranchSettings,
  type PaymentAccount,
} from './data';
import { formatCoordinates, parseCoordinates } from './geo';
import { storeDetailsSchema } from './schemas';
import { StoreSettingsPage } from './StoreSettingsPage';

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
const accounts = vi.hoisted(() => ({ data: [] as PaymentAccount[] }));

vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  updateBranchSettings: vi.fn(),
  usePaymentAccounts: () => ({ data: accounts.data, loading: false, error: false }),
  createPaymentAccount: vi.fn(),
  updatePaymentAccount: vi.fn(),
}));
vi.mock('@/features/discounts/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/discounts/data')>()),
  useDiscounts: () => ({ data: [], loading: false, error: false }),
}));

const BRANCH: BranchSettings = {
  id: 'main',
  name: 'Eragon Store',
  address: '12 Rizal St.',
  contact: null,
  tin: null,
  receiptFooter: null,
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

function renderPage(branch: BranchSettings = BRANCH) {
  render(
    <MemoryRouter>
      <BranchContext.Provider value={{ data: [branch], loading: false, error: false }}>
        <StoreSettingsPage />
      </BranchContext.Provider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const save = vi.mocked(updateBranchSettings);

function fakeLocation(result: { lat: number; lng: number; accuracy: number } | { code: number }) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (
        ok: (position: {
          coords: { latitude: number; longitude: number; accuracy: number };
        }) => void,
        fail: (error: { code: number; PERMISSION_DENIED: 1; TIMEOUT: 3 }) => void,
      ) => {
        if ('code' in result) fail({ code: result.code, PERMISSION_DENIED: 1, TIMEOUT: 3 });
        else
          ok({
            coords: { latitude: result.lat, longitude: result.lng, accuracy: result.accuracy },
          });
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue();
  vi.mocked(createPaymentAccount).mockResolvedValue('a9');
  vi.mocked(updatePaymentAccount).mockResolvedValue(undefined);
  accounts.data = [];
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
});

describe('coordinates', () => {
  test('parse the way Google Maps copies them', () => {
    expect(parseCoordinates('14.599512, 120.984219')).toEqual({ lat: 14.599512, lng: 120.984219 });
    expect(parseCoordinates(' 14.5995,120.9842 ')).toEqual({ lat: 14.5995, lng: 120.9842 });
    expect(parseCoordinates('-33.86 151.21')).toEqual({ lat: -33.86, lng: 151.21 });
  });

  test('refuse anything else', () => {
    for (const bad of ['', '14.6', 'Manila', '91, 120', '14.6, 181', '14.6; 120.9']) {
      expect(parseCoordinates(bad)).toBeNull();
    }
  });

  test('format to six decimals', () => {
    expect(formatCoordinates(14.5995123456, 120.98421)).toBe('14.599512, 120.984210');
  });
});

describe('store details validation', () => {
  const valid = {
    name: 'Store',
    address: '',
    contact: '',
    tin: '',
    receiptFooter: '',
    idleLockMinutes: '15',
  };
  test.each([
    [{ name: '  ' }, 'Enter the store name.'],
    [{ tin: '12345' }, 'Use the TIN format, for example 123-456-789-000.'],
    [{ idleLockMinutes: '0' }, 'Use 1 to 240 minutes.'],
    [{ idleLockMinutes: '300' }, 'Use 1 to 240 minutes.'],
  ])('%o is refused', (patch, message) => {
    const result = storeDetailsSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  test('accepts TINs with or without dashes and a branch code', () => {
    for (const tin of ['123456789', '123-456-789', '123-456-789-000', '123-456-789-00000']) {
      expect(storeDetailsSchema.safeParse({ ...valid, tin }).success).toBe(true);
    }
  });
});

describe('Settings > Store (SYS-01)', () => {
  test('saves the store details, with empty optional fields cleared', async () => {
    const user = renderPage();
    const contact = screen.getByLabelText('Contact number');
    await user.type(contact, '0917 123 4567');
    await user.clear(screen.getByLabelText('Lock after (minutes idle)'));
    await user.type(screen.getByLabelText('Lock after (minutes idle)'), '10');
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    expect(save).toHaveBeenCalledWith({
      name: 'Eragon Store',
      address: '12 Rizal St.',
      contact: '0917 123 4567',
      tin: null,
      receipt_footer: null,
      idle_lock_minutes: 10,
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  test('shows field errors and sends nothing', async () => {
    const user = renderPage();
    await user.clear(screen.getByLabelText('Store name'));
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Enter the store name.')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  test('explains a refusal from the server', async () => {
    save.mockRejectedValue({ code: '22023', message: 'invalid_input' });
    const user = renderPage();
    await user.type(screen.getByLabelText('Contact number'), '0917');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    expect(
      await screen.findByText('Some details are not valid. Check the form.'),
    ).toBeInTheDocument();
  });

  test('reminds the Owner while the store location is not set (ATT-02)', () => {
    renderPage();
    expect(screen.getByText('Store location not set.')).toBeInTheDocument();
    expect(screen.getByLabelText('Allowed distance (metres)')).toHaveValue('100');
  });

  test('"Use my current location" fills the coordinates; saving sends them with the radius', async () => {
    fakeLocation({ lat: 14.5995123, lng: 120.9842111, accuracy: 12 });
    const user = renderPage();
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(screen.getByLabelText('Coordinates (latitude, longitude)')).toHaveValue(
      '14.599512, 120.984211',
    );
    expect(screen.getByText(/accurate to about ±12 m/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save location' }));
    expect(save).toHaveBeenCalledWith({
      store_lat: 14.599512,
      store_lng: 120.984211,
      radius_m: 100,
    });
  });

  test('warns when the reading is too rough to trust', async () => {
    fakeLocation({ lat: 14.6, lng: 120.98, accuracy: 85 });
    const user = renderPage();
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(screen.getByText(/Accurate to about ±85 m only/)).toBeInTheDocument();
  });

  test('explains a refused location permission', async () => {
    fakeLocation({ code: 1 });
    const user = renderPage();
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(screen.getByText(/Location permission is off for this site/)).toBeInTheDocument();
  });

  test('typed coordinates work too; emptying them turns the check off', async () => {
    const user = renderPage({ ...BRANCH, storeLat: 14.6, storeLng: 120.98, radiusM: 150 });
    expect(screen.queryByText('Store location not set.')).toBeNull();
    expect(screen.getByRole('link', { name: /Check the saved location/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=14.6,120.98',
    );

    const field = screen.getByLabelText('Coordinates (latitude, longitude)');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save location' }));
    expect(save).toHaveBeenCalledWith({ store_lat: null, store_lng: null, radius_m: 150 });
  });

  test('refuses malformed coordinates and a radius out of range', async () => {
    const user = renderPage();
    await user.type(screen.getByLabelText('Coordinates (latitude, longitude)'), 'Manila');
    await user.clear(screen.getByLabelText('Allowed distance (metres)'));
    await user.type(screen.getByLabelText('Allowed distance (metres)'), '5');
    await user.click(screen.getByRole('button', { name: 'Save location' }));
    expect(await screen.findByText(/Enter latitude and longitude/)).toBeInTheDocument();
    expect(screen.getByText('Use 10 to 2000 metres.')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('Checkout settings (POS-04, POS-07)', () => {
  test('the VAT part of a VAT-inclusive total', () => {
    expect(vatPart(112, 12)).toBe(12);
    expect(vatPart(100, 12)).toBe(10.71);
    expect(vatPart(250, 12.5)).toBe(27.78);
  });

  test('no discount limit any more (POS-03)', () => {
    renderPage();
    expect(screen.queryByText(/Discount limit/)).toBeNull();
  });

  test('VAT is off and cash rounding on by default; the rate shows only with VAT on', async () => {
    const user = renderPage();
    const vat = screen.getByRole('switch', { name: 'VAT registered' });
    const round = screen.getByRole('switch', { name: 'Round cash totals to the nearest peso' });
    expect(vat).not.toBeChecked();
    expect(round).toBeChecked();
    expect(screen.queryByLabelText('VAT rate (%)')).toBeNull();
    expect(
      screen.getByText(/charged ₱124.00 and the slip shows “Rounding \+₱0.25”/),
    ).toBeInTheDocument();

    await user.click(vat);
    expect(screen.getByLabelText('VAT rate (%)')).toHaveValue('12');
    expect(
      screen.getByText('A ₱100.00 sale includes ₱10.71 VAT (₱100.00 × 12 ÷ 112).'),
    ).toBeInTheDocument();
    await user.click(round);
    await user.click(screen.getByRole('button', { name: 'Save checkout settings' }));
    expect(save).toHaveBeenCalledWith({ vat_registered: true, vat_rate: 12, round_cash: false });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  test('refuses a VAT rate out of range', async () => {
    const user = renderPage({ ...BRANCH, vatRegistered: true });
    const rate = screen.getByLabelText('VAT rate (%)');
    for (const [typed, message] of [
      ['0', 'Use 0.01% to 50%.'],
      ['12%', 'Enter a percent, for example 12 or 12.5.'],
      ['12.345', 'Enter a percent, for example 12 or 12.5.'],
    ] as const) {
      await user.clear(rate);
      await user.type(rate, typed);
      await user.click(screen.getByRole('button', { name: 'Save checkout settings' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    }
    expect(save).not.toHaveBeenCalled();
  });
});

describe('GCash and Maya accounts (POS-04)', () => {
  const GCASH: PaymentAccount = {
    id: 'a1',
    provider: 'gcash',
    label: 'Main GCash',
    number: '0917 123 4567',
    active: true,
  };

  test('with none, it says GCash and Maya still work; the Owner adds one', async () => {
    const user = renderPage();
    expect(screen.getByText(/No account yet. GCash and Maya still work/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    const form = screen.getByRole('form', { name: 'Add a payment account' });
    await user.click(within(form).getByRole('radio', { name: 'Maya' }));
    await user.type(within(form).getByLabelText('Label'), ' Store Maya ');
    await user.type(within(form).getByLabelText('Number'), '0917 765 4321');
    await user.click(within(form).getByRole('button', { name: 'Add account' }));
    expect(createPaymentAccount).toHaveBeenCalledWith({
      provider: 'maya',
      label: 'Store Maya',
      number: '0917 765 4321',
    });
    await vi.waitFor(() =>
      expect(screen.queryByRole('form', { name: /Add a payment/ })).toBeNull(),
    );
  });

  test('refuses a missing label and a number that is not one', async () => {
    const user = renderPage();
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    const form = screen.getByRole('form', { name: 'Add a payment account' });
    await user.type(within(form).getByLabelText('Number'), 'call me');
    await user.click(within(form).getByRole('button', { name: 'Add account' }));
    expect(
      await within(form).findByText('Enter a label, for example “Main GCash”.'),
    ).toBeInTheDocument();
    expect(
      within(form).getByText('Enter the number, for example 0917 123 4567.'),
    ).toBeInTheDocument();
    expect(createPaymentAccount).not.toHaveBeenCalled();
  });

  test('a label already used says so', async () => {
    vi.mocked(createPaymentAccount).mockRejectedValue({ code: '23505', message: 'name_taken' });
    accounts.data = [GCASH];
    const user = renderPage();
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    const form = screen.getByRole('form', { name: 'Add a payment account' });
    await user.type(within(form).getByLabelText('Label'), 'main gcash');
    await user.type(within(form).getByLabelText('Number'), '09171111111');
    await user.click(within(form).getByRole('button', { name: 'Add account' }));
    expect(
      await within(form).findByText(/Another payment account already has this label/),
    ).toBeInTheDocument();
  });

  test('one account is picked automatically; it can be edited, deactivated, reactivated', async () => {
    accounts.data = [
      GCASH,
      { ...GCASH, id: 'a2', label: 'Old Maya', provider: 'maya', active: false },
    ];
    const user = renderPage();
    expect(screen.getByText(/Checkout picks this account automatically/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Payment accounts' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'GCash Main GCash',
      'Maya Old Maya',
    ]);
    expect(within(rows[1]!).getByText('Inactive')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Deactivate Main GCash' }));
    expect(updatePaymentAccount).toHaveBeenCalledWith('a1', { active: false });
    await user.click(screen.getByRole('button', { name: 'Reactivate Old Maya' }));
    expect(updatePaymentAccount).toHaveBeenCalledWith('a2', { active: true });

    await user.click(screen.getByRole('button', { name: 'Edit Main GCash' }));
    const form = screen.getByRole('form', { name: 'Edit Main GCash' });
    expect(
      within(form).getByText(/To switch it to Maya, deactivate it and add a new one/),
    ).toBeInTheDocument();
    const number = within(form).getByLabelText('Number');
    await user.clear(number);
    await user.type(number, '0918 000 1111');
    await user.click(within(form).getByRole('button', { name: 'Save account' }));
    expect(updatePaymentAccount).toHaveBeenLastCalledWith('a1', { number: '0918 000 1111' });
  });

  test('with several active, staff pick', () => {
    accounts.data = [GCASH, { ...GCASH, id: 'a2', label: 'Store Maya', provider: 'maya' }];
    renderPage();
    expect(screen.getByText(/Staff pick which account the customer paid/)).toBeInTheDocument();
  });
});

describe('branch row and audit log', () => {
  test('toBranch reads numbers from the database row', () => {
    expect(
      toBranch({
        id: 'main',
        name: 'S',
        vat_registered: true,
        vat_rate: '12.50',
        idle_lock_minutes: 10,
        store_lat: 14.6,
        store_lng: 120.98,
        radius_m: 150,
      }),
    ).toMatchObject({
      vatRegistered: true,
      vatRate: 12.5,
      roundCash: true,
      idleLockMinutes: 10,
      storeLat: 14.6,
      radiusM: 150,
    });
  });

  test('a store settings change reads as a sentence with old and new values', () => {
    const entry: AuditRecord = {
      id: '1',
      action: 'branch.update',
      actorId: 'o1',
      targetId: 'main',
      deviceTag: null,
      before: { radius_m: 100, name: 'Store' },
      after: { radius_m: 150, name: 'Eragon Store' },
      reason: null,
      createdAt: null,
    };
    expect(describeAudit(entry, 'x')).toMatchObject({
      what: 'changed store settings',
      change: 'Radius (m): 100 → 150 · Store name: Store → Eragon Store',
    });
  });

  const audit = (overrides: Partial<AuditRecord>): AuditRecord => ({
    id: '1',
    action: 'branch.update',
    actorId: 'o1',
    targetId: 'main',
    deviceTag: null,
    before: null,
    after: null,
    reason: null,
    createdAt: null,
    ...overrides,
  });

  test('VAT and rounding changes read in plain words', () => {
    expect(
      describeAudit(
        audit({
          before: { vat_registered: false, vat_rate: 12, round_cash: true },
          after: { vat_registered: true, vat_rate: 12.5, round_cash: false },
        }),
        'x',
      ).change,
    ).toBe('VAT registered: No → Yes · VAT rate: 12% → 12.5% · Round cash to the peso: Yes → No');
  });

  test('payment account entries read as sentences', () => {
    expect(
      describeAudit(
        audit({
          action: 'payment.accountCreate',
          after: { provider: 'gcash', label: 'Main GCash', number: '0917 123 4567' },
        }),
        'x',
      ),
    ).toMatchObject({ what: 'added GCash account “Main GCash”', change: '0917 123 4567' });
    expect(
      describeAudit(
        audit({
          action: 'payment.accountUpdate',
          before: { label: 'Maya', provider: 'maya', active: true },
          after: { active: false },
        }),
        'x',
      ),
    ).toMatchObject({ what: 'deactivated Maya account “Maya”', change: '' });
    expect(
      describeAudit(
        audit({
          action: 'payment.accountUpdate',
          before: { label: 'Maya', provider: 'maya', number: '0917 765 4321' },
          after: { label: 'Store Maya', number: '0918 000 1111' },
        }),
        'x',
      ),
    ).toMatchObject({
      what: 'changed Maya account “Maya”',
      change: 'Label: Maya → Store Maya · Number: 0917 765 4321 → 0918 000 1111',
    });
  });
});
