import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api, ApiError, describeApiError } from './api';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }));
vi.mock('./device', () => ({ getDeviceTag: () => 'A1B2' }));

const refusal = (status: number, body: unknown) => ({
  data: null,
  error: { context: new Response(JSON.stringify(body), { status }) },
});

beforeEach(() => invoke.mockReset());

describe('api', () => {
  test('sends the action, the input and this device tag to admin-users', async () => {
    invoke.mockResolvedValue({ data: { uid: 'u1', role: 'sales' }, error: null });
    await expect(api.setUserRole({ uid: 'u1', role: 'sales' })).resolves.toEqual({
      uid: 'u1',
      role: 'sales',
    });
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'setRole', input: { uid: 'u1', role: 'sales', deviceTag: 'A1B2' } },
    });
  });

  test('a refusal carries the code and message the server gave', async () => {
    invoke.mockResolvedValue(
      refusal(409, {
        error: { code: 'already-exists', message: 'This user code is already taken.' },
      }),
    );
    const error = await api.updateUser({ uid: 'u1', userCode: 'JR' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('already-exists');
    expect(describeApiError(error)).toBe('This user code is already taken.');
  });

  test('a session the gateway no longer accepts reads as signed out', async () => {
    invoke.mockResolvedValue(refusal(401, { message: 'Invalid JWT' }));
    const error = await api.signOutEverywhere({ uid: 'u1' }).catch((e: unknown) => e);
    expect((error as ApiError).code).toBe('unauthenticated');
  });

  test('no answer at all reads as offline', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to send a request') });
    const error = await api.deactivateUser({ uid: 'u1' }).catch((e: unknown) => e);
    expect(describeApiError(error)).toMatch(/No internet connection/);
  });
});

describe('describeApiError', () => {
  test('invalid input points at the form', () => {
    expect(describeApiError(new ApiError('invalid-argument', 'Invalid input.'))).toBe(
      'Some details are not valid. Check the form.',
    );
  });

  test('server faults and unknown errors stay generic', () => {
    expect(describeApiError(new ApiError('internal', 'stack trace'))).toBe(
      'Something went wrong. Try again.',
    );
    expect(describeApiError(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});
