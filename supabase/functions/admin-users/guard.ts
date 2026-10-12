import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { HttpError } from './errors.ts';

export interface OwnerContext {
  uid: string;
  branchId: string;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

/** Reads a claim from a token that Supabase Auth has already verified. */
function claimOf(token: string, name: string): unknown {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as Record<string, unknown>)[name];
  } catch {
    return undefined;
  }
}

/**
 * SEC-08: every action passes through here before doing anything. Checks, in order:
 * a token that Supabase Auth accepts (signature, expiry, and a session that still exists, so
 * a token issued before "sign out everywhere" is refused: SEC-13), then the account's live
 * profile (Owner role and active flag, read now, not from the token: SEC-04), then the
 * Owner's second step (SEC-05).
 */
export async function requireOwner(request: Request, admin: SupabaseClient): Promise<OwnerContext> {
  const token = bearerToken(request);
  if (!token) throw new HttpError('unauthenticated', 'Sign in first.');

  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user) {
    throw new HttpError('unauthenticated', 'This session was signed out. Sign in again.');
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, branch_id, active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) {
    console.error('admin-users: profile lookup failed', profileError.message);
    throw new HttpError('internal', 'Something went wrong. Try again.');
  }
  const bannedUntil = (user as { banned_until?: unknown }).banned_until;
  const banned = typeof bannedUntil === 'string' && Date.parse(bannedUntil) > Date.now();
  if (!profile || profile.active !== true || profile.role !== 'owner' || banned) {
    throw new HttpError('permission-denied', 'Only the Owner can do this.');
  }
  if (claimOf(token, 'aal') !== 'aal2') {
    throw new HttpError('permission-denied', 'Two-step sign-in is required for the Owner.');
  }

  return { uid: user.id, branchId: String(profile.branch_id) };
}

/** Validates input against a schema; anything else is rejected (SEC-08). */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      'invalid-argument',
      'Invalid input.',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
