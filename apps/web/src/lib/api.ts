import { httpsCallable } from 'firebase/functions';
import type { Role } from '@/features/auth/roles';
import { getDeviceTag } from './device';
import { functions } from './firebase';

/**
 * Owner-only Cloud Functions (AUTH-02..04). The server checks auth, role, active flag,
 * App Check and the input again; nothing here is trusted (SEC-08).
 */
function call<Input extends object, Output>(name: string) {
  const callable = httpsCallable<Input & { deviceTag: string }, Output>(functions, name);
  return async (input: Input): Promise<Output> => {
    const result = await callable({ ...input, deviceTag: getDeviceTag() });
    return result.data;
  };
}

export const api = {
  createUser: call<
    { email: string; displayName: string; role: Role; userCode: string },
    { uid: string; resetLink: string }
  >('createUser'),
  updateUser: call<{ uid: string; displayName?: string; userCode?: string }, { uid: string }>(
    'updateUser',
  ),
  setUserRole: call<{ uid: string; role: Role }, { uid: string; role: Role }>('setUserRole'),
  deactivateUser: call<{ uid: string; reason?: string }, { uid: string }>('deactivateUser'),
  signOutEverywhere: call<{ uid: string }, { uid: string }>('signOutEverywhere'),
  createPasswordResetLink: call<{ uid: string }, { uid: string; resetLink: string }>(
    'createPasswordResetLink',
  ),
};

// Codes whose server message is written for the Owner to read.
const READABLE = new Set([
  'functions/already-exists',
  'functions/failed-precondition',
  'functions/not-found',
  'functions/permission-denied',
  'functions/unauthenticated',
]);

export function describeApiError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  if (READABLE.has(code) && error instanceof Error) return error.message;
  if (code === 'functions/invalid-argument') return 'Some details are not valid. Check the form.';
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return 'No internet connection. This needs to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}
