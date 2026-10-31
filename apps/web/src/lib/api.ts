import type { Role } from '@/features/auth/roles';
import { getDeviceTag } from './device';
import { supabase } from './supabase';

type Action =
  | 'create'
  | 'update'
  | 'setRole'
  | 'deactivate'
  | 'reactivate'
  | 'signOutEverywhere'
  | 'passwordResetLink';

/** An error from the `admin-users` Edge Function, with the code the server gave it. */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function toApiError(error: unknown): Promise<ApiError> {
  // The function answered with an error status: its body says which one.
  const response = (error as { context?: unknown } | null)?.context;
  if (response instanceof Response) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: unknown; message?: unknown };
    } | null;
    if (typeof body?.error?.code === 'string') {
      return new ApiError(body.error.code, String(body.error.message ?? ''));
    }
    // Refused by the gateway before the function ran: the session is no longer valid.
    if (response.status === 401) return new ApiError('unauthenticated', 'Sign in again.');
    return new ApiError('internal', '');
  }
  // No answer at all: the request never arrived.
  return new ApiError('unavailable', '');
}

/**
 * The Owner-only `admin-users` Edge Function (AUTH-02..04). The server checks the token,
 * role, active flag, second step and the input again; nothing here is trusted (SEC-08).
 */
function call<Input extends object, Output>(action: Action) {
  return async (input: Input): Promise<Output> => {
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action, input: { ...input, deviceTag: getDeviceTag() } },
    });
    if (error) throw await toApiError(error);
    return data as Output;
  };
}

export const api = {
  createUser: call<
    { email: string; displayName: string; role: Role; userCode: string },
    { uid: string; resetLink: string }
  >('create'),
  updateUser: call<{ uid: string; displayName?: string; userCode?: string }, { uid: string }>(
    'update',
  ),
  setUserRole: call<{ uid: string; role: Role }, { uid: string; role: Role }>('setRole'),
  deactivateUser: call<{ uid: string; reason?: string }, { uid: string }>('deactivate'),
  reactivateUser: call<{ uid: string }, { uid: string }>('reactivate'),
  signOutEverywhere: call<{ uid: string }, { uid: string }>('signOutEverywhere'),
  createPasswordResetLink: call<{ uid: string }, { uid: string; resetLink: string }>(
    'passwordResetLink',
  ),
};

// Codes whose server message is written for the Owner to read.
const READABLE = new Set([
  'already-exists',
  'failed-precondition',
  'not-found',
  'permission-denied',
  'unauthenticated',
]);

export function describeApiError(error: unknown): string {
  const code = error instanceof ApiError ? error.code : '';
  if (READABLE.has(code) && error instanceof Error && error.message) return error.message;
  if (code === 'invalid-argument') return 'Some details are not valid. Check the form.';
  if (code === 'unavailable') return 'No internet connection. This needs to be online; try again.';
  return 'Something went wrong. Try again.';
}
