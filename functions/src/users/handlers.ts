import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { adminAuth, db } from '../lib/admin.js';
import { auditEntry } from '../lib/audit.js';
import { parseInput, requireOwner, type OwnerContext } from '../lib/guard.js';
import type { AccessClaims, Role } from '../lib/roles.js';
import {
  createUserSchema,
  deactivateUserSchema,
  setUserRoleSchema,
  userIdSchema,
} from './schemas.js';

interface UserDoc {
  displayName: string;
  email: string;
  role: Role;
  userCode: string;
  branchId: string;
  active: boolean;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Loads a user of the caller's own branch. Other branches look the same as "not found". */
async function loadBranchUser(owner: OwnerContext, uid: string): Promise<UserDoc> {
  const snapshot = await db().collection('users').doc(uid).get();
  const data = snapshot.data() as UserDoc | undefined;
  if (!data || data.branchId !== owner.branchId) {
    throw new HttpsError('not-found', 'User not found.');
  }
  return data;
}

function refuseSelf(owner: OwnerContext, uid: string, what: string) {
  // The store must never lose its only Owner by accident.
  if (owner.uid === uid) {
    throw new HttpsError('failed-precondition', `You cannot ${what} your own account.`);
  }
}

/**
 * AUTH-02, SEC-01: the only way an account is ever created. The new user gets a random
 * password nobody knows and sets their own through the one-time link returned to the Owner.
 */
export async function createUserHandler(request: CallableRequest<unknown>) {
  const owner = await requireOwner(request);
  const input = parseInput(createUserSchema, request.data);

  const auth = adminAuth();
  let uid: string;
  try {
    const created = await auth.createUser({
      email: input.email,
      displayName: input.displayName,
      password: randomBytes(32).toString('base64url'),
      emailVerified: false,
      disabled: false,
    });
    uid = created.uid;
  } catch (error) {
    if (errorCode(error) === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with this email already exists.');
    }
    throw error;
  }

  try {
    const claims: AccessClaims = { role: input.role, branchId: owner.branchId, active: true };
    await auth.setCustomUserClaims(uid, claims);

    const users = db().collection('users');
    await db().runTransaction(async (tx) => {
      const sameCode = await tx.get(
        users
          .where('branchId', '==', owner.branchId)
          .where('userCode', '==', input.userCode)
          .limit(1),
      );
      if (!sameCode.empty) {
        throw new HttpsError('already-exists', 'This user code is already taken.');
      }
      tx.create(users.doc(uid), {
        displayName: input.displayName,
        email: input.email,
        role: input.role,
        userCode: input.userCode,
        branchId: owner.branchId,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.create(
        db().collection('auditLogs').doc(),
        auditEntry({
          action: 'user.create',
          actorId: owner.uid,
          branchId: owner.branchId,
          targetType: 'user',
          targetId: uid,
          after: {
            email: input.email,
            displayName: input.displayName,
            role: input.role,
            userCode: input.userCode,
          },
        }),
      );
    });
  } catch (error) {
    // Do not leave a half-made account behind.
    await auth.deleteUser(uid).catch(() => undefined);
    throw error;
  }

  const resetLink = await auth.generatePasswordResetLink(input.email);
  return { uid, resetLink };
}

/** AUTH-03: the role claim is set only here, by the Owner. */
export async function setUserRoleHandler(request: CallableRequest<unknown>) {
  const owner = await requireOwner(request);
  const input = parseInput(setUserRoleSchema, request.data);
  refuseSelf(owner, input.uid, 'change the role of');

  const user = await loadBranchUser(owner, input.uid);
  if (!user.active) throw new HttpsError('failed-precondition', 'This account is turned off.');
  if (user.role === input.role) return { uid: input.uid, role: input.role };

  const auth = adminAuth();
  const claims: AccessClaims = { role: input.role, branchId: owner.branchId, active: true };
  await auth.setCustomUserClaims(input.uid, claims);
  // Old tokens still carry the old role; make every device sign in again.
  await auth.revokeRefreshTokens(input.uid);

  const batch = db().batch();
  batch.update(db().collection('users').doc(input.uid), { role: input.role });
  batch.create(
    db().collection('auditLogs').doc(),
    auditEntry({
      action: 'user.setRole',
      actorId: owner.uid,
      branchId: owner.branchId,
      targetType: 'user',
      targetId: input.uid,
      before: { role: user.role },
      after: { role: input.role },
    }),
  );
  await batch.commit();
  return { uid: input.uid, role: input.role };
}

/** SEC-04: disable the account, remove its claims and revoke its sessions in one call. */
export async function deactivateUserHandler(request: CallableRequest<unknown>) {
  const owner = await requireOwner(request);
  const input = parseInput(deactivateUserSchema, request.data);
  refuseSelf(owner, input.uid, 'turn off');

  const user = await loadBranchUser(owner, input.uid);

  const auth = adminAuth();
  await auth.updateUser(input.uid, { disabled: true });
  await auth.setCustomUserClaims(input.uid, null);
  await auth.revokeRefreshTokens(input.uid);

  // AUTH-02: users are never hard-deleted.
  const batch = db().batch();
  batch.update(db().collection('users').doc(input.uid), { active: false });
  batch.create(
    db().collection('auditLogs').doc(),
    auditEntry({
      action: 'user.deactivate',
      actorId: owner.uid,
      branchId: owner.branchId,
      targetType: 'user',
      targetId: input.uid,
      before: { active: user.active, role: user.role },
      after: { active: false },
      reason: input.reason,
    }),
  );
  await batch.commit();
  return { uid: input.uid, active: false };
}

/** AUTH-04, SEC-13: sign a user out of every device without turning the account off. */
export async function signOutEverywhereHandler(request: CallableRequest<unknown>) {
  const owner = await requireOwner(request);
  const input = parseInput(userIdSchema, request.data);
  await loadBranchUser(owner, input.uid);

  await adminAuth().revokeRefreshTokens(input.uid);
  await db()
    .collection('auditLogs')
    .doc()
    .create(
      auditEntry({
        action: 'user.signOutEverywhere',
        actorId: owner.uid,
        branchId: owner.branchId,
        targetType: 'user',
        targetId: input.uid,
      }),
    );
  return { uid: input.uid };
}

/**
 * "Forgot your password? Ask the Owner to reset it." Returns a one-time link for the Owner
 * to pass on; the link itself is never stored or logged.
 */
export async function createPasswordResetLinkHandler(request: CallableRequest<unknown>) {
  const owner = await requireOwner(request);
  const input = parseInput(userIdSchema, request.data);
  const user = await loadBranchUser(owner, input.uid);
  if (!user.active) throw new HttpsError('failed-precondition', 'This account is turned off.');

  const resetLink = await adminAuth().generatePasswordResetLink(user.email);
  await db()
    .collection('auditLogs')
    .doc()
    .create(
      auditEntry({
        action: 'user.passwordResetLink',
        actorId: owner.uid,
        branchId: owner.branchId,
        targetType: 'user',
        targetId: input.uid,
      }),
    );
  return { uid: input.uid, resetLink };
}
