import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { describeAudit } from '@/features/audit/describe';
import type { AuditRecord } from '@/features/users/data';
import { BranchContext, toBranch, updateBranchSettings, type BranchSettings } from './data';
import { formatCoordinates, parseCoordinates } from './geo';
import { storeDetailsSchema } from './schemas';
import { StoreSettingsPage } from './StoreSettingsPage';

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: {} }));
vi.mock('./data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  updateBranchSettings: vi.fn(),
}));

const BRANCH: BranchSettings = {
  id: 'main',
  name: 'Eragon Store',
  address: '12 Rizal St.',
  contact: null,
  tin: null,
  receiptFooter: null,
  salesDiscountLimit: null,
  idleLockMinutes: 15,
  storeLat: null,
  storeLng: null,
  radiusM: 100,
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
    discountLimit: '',
    idleLockMinutes: '15',
  };
  test.each([
    [{ name: '  ' }, 'Enter the store name.'],
    [{ tin: '12345' }, 'Use the TIN format, for example 123-456-789-000.'],
    [{ discountLimit: '-5' }, 'Enter an amount in pesos, for example 50 or 50.00.'],
    [{ discountLimit: '5.555' }, 'Enter an amount in pesos, for example 50 or 50.00.'],
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
    await user.type(screen.getByLabelText('Discount limit per sale (₱)'), '50');
    await user.clear(screen.getByLabelText('Lock after (minutes idle)'));
    await user.type(screen.getByLabelText('Lock after (minutes idle)'), '10');
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    expect(save).toHaveBeenCalledWith({
      name: 'Eragon Store',
      address: '12 Rizal St.',
      contact: '0917 123 4567',
      tin: null,
      receipt_footer: null,
      sales_discount_limit: 50,
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

describe('branch row and audit log', () => {
  test('toBranch reads numbers from the database row', () => {
    expect(
      toBranch({
        id: 'main',
        name: 'S',
        sales_discount_limit: '50.00',
        idle_lock_minutes: 10,
        store_lat: 14.6,
        store_lng: 120.98,
        radius_m: 150,
      }),
    ).toMatchObject({ salesDiscountLimit: 50, idleLockMinutes: 10, storeLat: 14.6, radiusM: 150 });
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
});
