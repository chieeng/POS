import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addToOutbox,
  countWaiting,
  registerSender,
  resetOutboxForTests,
  sendFailure,
  syncOutbox,
  watchOutbox,
  type OutboxCounts,
  type SendResult,
} from './outbox';
import { clearOfflineCache } from './offlineCache';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@/lib/device', () => ({ getDeviceTag: () => 'A1B2' }));

const sale = (id: string, uid = 'u1') => ({
  id,
  kind: 'sale' as const,
  uid,
  branchId: 'main',
  payload: { total: 45 },
});

let stop: (() => void) | undefined;

beforeEach(async () => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  // Offline while items are added, so nothing sends before the test says so.
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  await resetOutboxForTests();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

function goOnline() {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
}

describe('the device outbox (NFR-02)', () => {
  it('sends waiting items oldest first and forgets them once the server has them', async () => {
    await addToOutbox(sale('s1'));
    await addToOutbox(sale('s2'));
    const sent: string[] = [];
    stop = registerSender('sale', async (item) => {
      sent.push(item.id);
      return { sent: true };
    });
    goOnline();
    await syncOutbox('u1');
    expect(sent).toEqual(['s1', 's2']);
    expect(await countWaiting('u1')).toBe(0);
  });

  it('keeps an item that could not be sent, and stops trying until the next run', async () => {
    await addToOutbox(sale('s1'));
    await addToOutbox(sale('s2'));
    const send = vi.fn(async (): Promise<SendResult> => ({ retry: true }));
    stop = registerSender('sale', send);
    goOnline();
    await syncOutbox('u1');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await countWaiting('u1')).toBe(2);
  });

  it('sends only the signed-in user’s items', async () => {
    await addToOutbox(sale('mine', 'u1'));
    await addToOutbox(sale('theirs', 'u2'));
    const sent: string[] = [];
    stop = registerSender('sale', async (item) => {
      sent.push(item.id);
      return { sent: true };
    });
    goOnline();
    await syncOutbox('u1');
    expect(sent).toEqual(['mine']);
    expect(await countWaiting('u2')).toBe(1);
  });

  it('never drops an item the server refuses: it needs attention, and the Owner is told', async () => {
    await addToOutbox(sale('s1'));
    stop = registerSender('sale', async () => ({ rejected: 'The drawer is closed.' }));
    goOnline();
    await syncOutbox('u1');

    expect(await countWaiting('u1')).toBe(0);
    expect(rpc).toHaveBeenCalledWith(
      'report_unsent',
      expect.objectContaining({
        p_item_id: 's1',
        p_kind: 'sale',
        p_error: 'The drawer is closed.',
        p_payload: { total: 45 },
        p_device_tag: 'A1B2',
      }),
    );

    const counts: OutboxCounts[] = [];
    const unwatch = watchOutbox('u1', (next) => counts.push(next));
    await vi.waitFor(() => expect(counts.at(-1)).toEqual({ waiting: 0, needsAttention: 1 }));
    unwatch();

    // Reported once: a later run does not report it again.
    await syncOutbox('u1');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('tries the report again later if it could not be sent', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    await addToOutbox(sale('s1'));
    stop = registerSender('sale', async () => ({ rejected: 'Refused.' }));
    goOnline();
    await syncOutbox('u1');
    await syncOutbox('u1');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('does nothing offline', async () => {
    await addToOutbox(sale('s1'));
    const send = vi.fn(async (): Promise<SendResult> => ({ sent: true }));
    stop = registerSender('sale', send);
    await syncOutbox('u1');
    expect(send).not.toHaveBeenCalled();
  });

  it('survives sign-out: clearing the saved product list leaves the outbox alone', async () => {
    await addToOutbox(sale('s1'));
    await clearOfflineCache();
    expect(await countWaiting('u1')).toBe(1);
  });
});

describe('sendFailure', () => {
  it('tries again on no connection, a server problem or an expired token', () => {
    expect(sendFailure(new TypeError('Failed to fetch'))).toEqual({ retry: true });
    expect(sendFailure({ status: 503, message: 'Service Unavailable' })).toEqual({ retry: true });
    expect(sendFailure({ status: 429 })).toEqual({ retry: true });
    expect(sendFailure({ status: 401, message: 'JWT expired' })).toEqual({ retry: true });
  });

  it('treats a refusal from the database as final, with its message', () => {
    expect(sendFailure({ status: 400, code: 'P0001', message: 'The drawer is closed.' })).toEqual({
      rejected: 'The drawer is closed.',
    });
    expect(sendFailure({ status: 403, message: '' })).toEqual({ rejected: 'Refused.' });
  });
});
