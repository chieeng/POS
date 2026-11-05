import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { OutboxItem } from '@/lib/outbox';
import { supabase } from '@/lib/supabase';
import {
  completeSale,
  describeSaleError,
  manilaDay,
  nextReceiptSequence,
  receiptNumber,
  sendSale,
  type SalePayload,
} from './data';
import { lineTotalCents, roundToPesoCents, saleTotals } from './totals';

vi.mock('@/lib/supabase', () => ({ env: {}, supabase: { rpc: vi.fn() } }));
vi.mock('@/lib/device', () => ({ getDeviceTag: () => 'A1B2' }));

const rpc = vi.mocked(supabase.rpc);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('sale totals, as the server works them out (POS-04)', () => {
  test('a line is qty × price to the centavo, half up', () => {
    expect(lineTotalCents(1.25, 99)).toBe(12375);
    expect(lineTotalCents(0.333, 45.5)).toBe(1515); // 15.1515 → ₱15.15
    expect(lineTotalCents(0.335, 45)).toBe(1508); // 15.075 → ₱15.08
    expect(lineTotalCents(3, 0.1)).toBe(30); // no 0.30000000000000004
    expect(lineTotalCents(100000, 1000000)).toBe(1e13);
  });

  test('cash rounds to the peso, exactly ₱0.50 up', () => {
    expect(roundToPesoCents(12375)).toBe(12400);
    expect(roundToPesoCents(12350)).toBe(12400);
    expect(roundToPesoCents(12349)).toBe(12300);
    expect(roundToPesoCents(12300)).toBe(12300);
  });

  test('cash: ₱123.75 is charged ₱124.00, rounding +₱0.25, change from ₱200', () => {
    expect(
      saleTotals([{ qty: 1.25, unitPrice: 99 }], [{ method: 'cash', amount: 200 }], true),
    ).toEqual({
      subtotal: 123.75,
      discountTotal: 0,
      nonCash: 0,
      cashPart: 123.75,
      cashDue: 124,
      rounding: 0.25,
      total: 124,
      change: 76,
      problem: null,
    });
  });

  test('rounding down, and rounding off', () => {
    const lines = [{ qty: 0.49, unitPrice: 252 }];
    expect(saleTotals(lines, [{ method: 'cash', amount: 123 }], true)).toMatchObject({
      rounding: -0.48,
      total: 123,
      change: 0,
    });
    expect(saleTotals(lines, [{ method: 'cash', amount: 123.48 }], false)).toMatchObject({
      rounding: 0,
      total: 123.48,
    });
  });

  test('GCash and Maya stay exact; in a split only the cash part is rounded', () => {
    const lines = [{ qty: 1.25, unitPrice: 99 }];
    expect(saleTotals(lines, [{ method: 'gcash', amount: 123.75 }], true)).toMatchObject({
      rounding: 0,
      total: 123.75,
      problem: null,
    });
    expect(
      saleTotals(
        lines,
        [
          { method: 'maya', amount: 50 },
          { method: 'cash', amount: 100 },
        ],
        true,
      ),
    ).toMatchObject({ cashPart: 73.75, cashDue: 74, rounding: 0.25, total: 124, change: 26 });
  });

  test('says what is missing before the sale can complete', () => {
    const lines = [{ qty: 1, unitPrice: 45 }];
    expect(saleTotals(lines, [], true).problem).toBe('cash_needed');
    expect(saleTotals(lines, [{ method: 'cash', amount: 40 }], true).problem).toBe('cash_short');
    expect(saleTotals(lines, [{ method: 'gcash', amount: 50 }], true).problem).toBe(
      'more_than_total',
    );
    expect(
      saleTotals(
        lines,
        [
          { method: 'gcash', amount: 45 },
          { method: 'cash', amount: 5 },
        ],
        true,
      ).problem,
    ).toBe('cash_not_needed');
  });
});

describe('receipt numbers (POS-08)', () => {
  test("the store's day in Manila", () => {
    expect(manilaDay(new Date('2026-11-05T16:30:00Z'))).toBe('20261106');
    expect(manilaDay(new Date('2026-11-05T15:59:00Z'))).toBe('20261105');
  });

  test('the sequence counts up through a day and starts again the next', () => {
    expect(nextReceiptSequence('20261106')).toBe(1);
    expect(nextReceiptSequence('20261106')).toBe(2);
    expect(nextReceiptSequence('20261107')).toBe(1);
  });

  test('user code, day, device tag and sequence', () => {
    const when = new Date('2026-11-06T02:00:00Z');
    expect(receiptNumber('JR', when)).toBe('JR-20261106-A1B2-1');
    expect(receiptNumber('JR', when)).toBe('JR-20261106-A1B2-2');
  });
});

const PAYLOAD: SalePayload = {
  id: '00000000-0000-4000-8000-000000000501',
  receipt_no: 'JR-20261106-A1B2-1',
  made_at: '2026-11-06T02:00:00.000Z',
  offline: false,
  round_cash: true,
  vat_rate: null,
  total: 90,
  lines: [{ product_id: 'p1', qty: 2, unit_price: 45 }],
  payments: [{ method: 'cash', amount: 100 }],
};

describe('sending a sale', () => {
  test('completeSale calls complete_sale with the device tag and reads the result', async () => {
    rpc.mockResolvedValue({
      data: {
        id: PAYLOAD.id,
        receiptNo: PAYLOAD.receipt_no,
        subtotal: 90,
        rounding: 0,
        total: 90,
        change: 10,
        vatRate: null,
        vatAmount: null,
        flags: [],
        attached: false,
      },
      error: null,
    } as never);
    await expect(completeSale(PAYLOAD)).resolves.toMatchObject({
      receiptNo: 'JR-20261106-A1B2-1',
      change: 10,
      attached: false,
    });
    expect(rpc).toHaveBeenCalledWith('complete_sale', { p_sale: PAYLOAD, p_device_tag: 'A1B2' });
  });

  const item = (): OutboxItem => ({
    id: PAYLOAD.id,
    kind: 'sale',
    uid: 'u1',
    branchId: 'main',
    payload: PAYLOAD as unknown as Record<string, unknown>,
    madeAt: 0,
    status: 'waiting',
    attempts: 0,
  });

  test('from the outbox it always goes as offline (POS-13: flagged, never refused)', async () => {
    rpc.mockResolvedValue({ data: { id: PAYLOAD.id }, error: null } as never);
    await expect(sendSale(item())).resolves.toEqual({ sent: true });
    expect(rpc).toHaveBeenCalledWith('complete_sale', {
      p_sale: { ...PAYLOAD, offline: true },
      p_device_tag: 'A1B2',
    });
  });

  test('no connection: tried again later; a refusal: kept as needing attention', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(sendSale(item())).resolves.toEqual({ retry: true });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'invalid_input' },
    } as never);
    await expect(sendSale(item())).resolves.toEqual({ rejected: 'invalid_input' });
  });

  test('refusals read in plain words', () => {
    expect(describeSaleError({ message: 'duplicate_reference', details: '1012345678' })).toBe(
      "Reference 1012345678 is already on another sale. Check the number on the customer's phone.",
    );
    expect(describeSaleError({ message: 'cash_short' })).toBe(
      'The cash given is less than what is due.',
    );
    expect(describeSaleError({ code: '42501' })).toBe('This account cannot record sales.');
  });
});
