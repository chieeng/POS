import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { adminAuth } from './admin.js';
import { readAccessClaims } from './roles.js';

export interface OwnerContext {
  uid: string;
  branchId: string;
}

/** True only inside the local Emulator Suite, which sets this variable itself. */
function inEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

/**
 * SEC-08: every callable passes through here before doing anything. Checks, in order:
 * signed in, App Check, role, active flag, the Owner's second factor (SEC-05), and then the
 * account's live state, so a token issued before a demotion, deactivation or
 * "sign out everywhere" is refused even though it has not expired yet (SEC-04).
 */
export async function requireOwner(request: CallableRequest<unknown>): Promise<OwnerContext> {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  // The function is also deployed with enforceAppCheck; this is the second lock. The
  // emulator does not issue App Check tokens.
  if (!request.app && !inEmulator()) {
    throw new HttpsError('failed-precondition', 'This request did not come from the app.');
  }

  const token = request.auth.token;
  const claims = readAccessClaims(token);
  if (!claims || claims.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the Owner can do this.');
  }
  // The Auth emulator cannot do TOTP, so this check is skipped there and only there.
  if (!inEmulator() && token.firebase?.sign_in_second_factor !== 'totp') {
    throw new HttpsError('permission-denied', 'Two-step sign-in is required for the Owner.');
  }

  const record = await adminAuth().getUser(request.auth.uid);
  const live = readAccessClaims(record.customClaims);
  if (record.disabled || !live || live.role !== 'owner' || live.branchId !== claims.branchId) {
    throw new HttpsError('permission-denied', 'Only the Owner can do this.');
  }
  if (record.tokensValidAfterTime) {
    const validAfterSeconds = Math.floor(Date.parse(record.tokensValidAfterTime) / 1000);
    if (token.auth_time < validAfterSeconds) {
      throw new HttpsError('unauthenticated', 'This session was signed out. Sign in again.');
    }
  }

  return { uid: request.auth.uid, branchId: claims.branchId };
}

/** Validates callable input against a schema; anything else is rejected (SEC-08). */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid input.',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
