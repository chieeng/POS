import { logger } from 'firebase-functions/v2';
import { HttpsError, type AuthBlockingEvent } from 'firebase-functions/v2/identity';
import { db } from '../lib/admin.js';
import { auditEntry } from '../lib/audit.js';
import { readAccessClaims } from '../lib/roles.js';

/**
 * Runs inside Firebase Auth before every sign-in completes, so the client cannot skip it.
 * - SEC-02: an account without a valid role and active flag is refused at the door.
 * - SYS-03: every successful sign-in is written to the audit log.
 */
export async function recordSignInHandler(event: AuthBlockingEvent) {
  const user = event.data;
  if (!user) throw new HttpsError('permission-denied', 'This account has no access.');
  const claims = readAccessClaims(user.customClaims);
  if (!claims) throw new HttpsError('permission-denied', 'This account has no access.');

  try {
    await db()
      .collection('auditLogs')
      .doc()
      .create(
        auditEntry({
          action: 'auth.signIn',
          actorId: user.uid,
          branchId: claims.branchId,
          targetType: 'user',
          targetId: user.uid,
        }),
      );
  } catch (error) {
    // A logging outage must not lock the whole store out; it is reported instead (SEC-14).
    logger.error('auth.signIn audit log write failed', { uid: user.uid, error });
  }
}
