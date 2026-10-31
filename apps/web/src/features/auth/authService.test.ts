import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearOfflineCache } from '@/lib/offlineCache';
import { useSession } from '@/stores/session';

type AuthCallback = (event: string, session: unknown) => void;
type StatusCallback = (status: string) => void;

const mock = vi.hoisted(() => ({
  authCallback: null as AuthCallback | null,
  statusCallback: null as StatusCallback | null,
  changeHandler: null as ((payload: { new: Record<string, unknown> }) => void) | null,
  profile: {} as Record<string, unknown>,
  getUserError: null as { status: number; message: string } | null,
  getUserCalls: 0,
}));

vi.mock('@/lib/offlineCache', () => ({ clearOfflineCache: vi.fn(() => Promise.resolve()) }));

vi.mock('@/lib/supabase', () => {
  const channel = {
    on: (_type: string, _filter: unknown, handler: typeof mock.changeHandler) => {
      mock.changeHandler = handler;
      return channel;
    },
    subscribe: (callback: StatusCallback) => {
      mock.statusCallback = callback;
      return channel;
    },
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: mock.profile, error: null }),
  };
  return {
    AUTH_STORAGE_KEY: 'test-auth',
    openedFromPasswordLink: false,
    createThrowawayClient: vi.fn(),
    supabase: {
      from: () => query,
      channel: () => channel,
      removeChannel: vi.fn(() => Promise.resolve()),
      rpc: vi.fn(() => Promise.resolve({ error: null })),
      auth: {
        onAuthStateChange: (callback: AuthCallback) => {
          mock.authCallback = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
        getUser: () => {
          mock.getUserCalls += 1;
          return Promise.resolve(
            mock.getUserError
              ? { data: { user: null }, error: mock.getUserError }
              : { error: null },
          );
        },
        getSession: () => Promise.resolve({ data: { session: null } }),
        signOut: vi.fn(() => Promise.resolve({ error: null })),
        mfa: {
          getAuthenticatorAssuranceLevel: () =>
            Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
        },
      },
    },
  };
});

const { ACCESS_CHECK_MS, startAuthListener } = await import('./authService');

const ACTIVE = {
  display_name: 'Test Two',
  email: 'two@tests.pos',
  role: 'sales',
  branch_id: 'main',
  active: true,
};

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
}

describe('live sign-out (SEC-04, SEC-13)', () => {
  let stop: () => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    mock.profile = { ...ACTIVE };
    mock.getUserError = null;
    mock.getUserCalls = 0;
    useSession.getState().setSignedOut();
    stop = startAuthListener();
    mock.authCallback?.('SIGNED_IN', { user: { id: 'u2', email: 'two@tests.pos' } });
    await settle();
    expect(useSession.getState().status).toBe('signedIn');
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  test('a Realtime message that the user was deactivated signs them out at once', async () => {
    mock.changeHandler?.({ new: { ...ACTIVE, active: false } });
    await settle();
    expect(useSession.getState().status).toBe('signedOut');
    expect(useSession.getState().notice).toBe('no-access');
    // Q2 (Oct 31, 2026): a deactivated user's phone keeps no product list.
    expect(clearOfflineCache).toHaveBeenCalled();
  });

  test('without Realtime, the minute check finds the deactivation', async () => {
    mock.profile = { ...ACTIVE, active: false };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCESS_CHECK_MS);
    });
    expect(useSession.getState().status).toBe('signedOut');
    expect(useSession.getState().notice).toBe('no-access');
  });

  test('a session ended by "sign out everywhere" is signed out by the check', async () => {
    mock.getUserError = { status: 403, message: 'Session not found' };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCESS_CHECK_MS);
    });
    expect(useSession.getState().status).toBe('signedOut');
    expect(clearOfflineCache).toHaveBeenCalled();
  });

  test('a server error from Auth keeps the saved product list', async () => {
    vi.mocked(clearOfflineCache).mockClear();
    mock.getUserError = { status: 500, message: 'Internal error' };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCESS_CHECK_MS);
    });
    expect(clearOfflineCache).not.toHaveBeenCalled();
  });

  test('a server error from Auth does not sign the user out', async () => {
    mock.getUserError = { status: 500, message: 'Internal error' };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCESS_CHECK_MS);
    });
    expect(useSession.getState().status).toBe('signedIn');
  });

  test('a Realtime reconnect or channel error triggers a check', async () => {
    const before = mock.getUserCalls;
    mock.statusCallback?.('SUBSCRIBED');
    await settle();
    expect(mock.getUserCalls).toBe(before);

    mock.profile = { ...ACTIVE, active: false };
    mock.statusCallback?.('CHANNEL_ERROR');
    await settle();
    expect(useSession.getState().status).toBe('signedOut');
  });
});
