import type { CallableRequest } from 'firebase-functions/v2/https';
import type { AuthBlockingEvent } from 'firebase-functions/v2/identity';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { recordSignInHandler } from '../auth/recordSignIn';
import { adminAuth, db } from '../lib/admin';
import {
  createPasswordResetLinkHandler,
  createUserHandler,
  deactivateUserHandler,
  setUserRoleHandler,
  signOutEverywhereHandler,
} from './handlers';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pos';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;

beforeAll(() => {
  if (!AUTH_HOST || !FIRESTORE_HOST) {
    throw new Error('Run these tests with `npm run test:emulators` from the repo root.');
  }
});

async function resetEmulators() {
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
}

type Claims = Record<string, unknown>;

async function seedUser(uid: string, claims: Claims | null, extra: Claims = {}) {
  await adminAuth().createUser({ uid, email: `${uid}@example.com`, password: 'password1234' });
  if (claims) {
    await adminAuth().setCustomUserClaims(uid, claims);
    await db()
      .collection('users')
      .doc(uid)
      .set({
        displayName: uid,
        email: `${uid}@example.com`,
        role: claims.role,
        userCode: uid.slice(0, 4).toUpperCase(),
        branchId: claims.branchId,
        active: true,
        ...extra,
      });
  }
}

const OWNER_CLAIMS = { role: 'owner', branchId: 'main', active: true };
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A callable request as the Functions runtime would hand it over. */
function requestAs(
  uid: string | null,
  claims: Claims,
  data: unknown,
  options: { appCheck?: boolean; secondFactor?: boolean; authTime?: number } = {},
): CallableRequest<unknown> {
  const { appCheck = true, secondFactor = true, authTime = nowSeconds() + 5 } = options;
  return {
    data,
    rawRequest: {},
    acceptsStreaming: false,
    ...(appCheck ? { app: { appId: 'test-app', token: {} } } : {}),
    ...(uid
      ? {
          auth: {
            uid,
            token: {
              ...claims,
              uid,
              auth_time: authTime,
              firebase: secondFactor ? { sign_in_second_factor: 'totp' } : {},
            },
          },
        }
      : {}),
  } as unknown as CallableRequest<unknown>;
}

const asOwner = (data: unknown) => requestAs('owner1', OWNER_CLAIMS, data);

async function auditLogs(action: string) {
  const snapshot = await db().collection('auditLogs').where('action', '==', action).get();
  return snapshot.docs.map((doc) => doc.data());
}

const newUser = {
  email: 'jun@example.com',
  displayName: 'Jun Reyes',
  role: 'sales',
  userCode: 'JR',
};

beforeEach(async () => {
  // Make sure the emulator-only App Check allowance is off for these tests.
  delete process.env.FUNCTIONS_EMULATOR;
  await resetEmulators();
  await seedUser('owner1', OWNER_CLAIMS);
});

describe('access checks shared by every callable (SEC-08)', () => {
  const handlers = [
    ['createUser', createUserHandler, newUser],
    ['setUserRole', setUserRoleHandler, { uid: 'sales1', role: 'specialSales' }],
    ['deactivateUser', deactivateUserHandler, { uid: 'sales1' }],
    ['signOutEverywhere', signOutEverywhereHandler, { uid: 'sales1' }],
    ['createPasswordResetLink', createPasswordResetLinkHandler, { uid: 'sales1' }],
  ] as const;

  describe.each(handlers)('%s', (_name, handler, data) => {
    beforeEach(async () => {
      await seedUser('sales1', { role: 'sales', branchId: 'main', active: true });
      await seedUser('special1', { role: 'specialSales', branchId: 'main', active: true });
    });

    test('refuses a caller who is not signed in', async () => {
      await expect(handler(requestAs(null, {}, data))).rejects.toMatchObject({
        code: 'unauthenticated',
      });
    });

    test('refuses a request without App Check', async () => {
      await expect(
        handler(requestAs('owner1', OWNER_CLAIMS, data, { appCheck: false })),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    test('refuses an account without claims', async () => {
      await seedUser('nobody', null);
      await expect(handler(requestAs('nobody', {}, data))).rejects.toMatchObject({
        code: 'permission-denied',
      });
    });

    test.each([
      ['sales1', 'sales'],
      ['special1', 'specialSales'],
    ])('refuses %s (%s)', async (uid, role) => {
      const claims = { role, branchId: 'main', active: true };
      await expect(handler(requestAs(uid, claims, data))).rejects.toMatchObject({
        code: 'permission-denied',
      });
    });

    test('refuses an Owner token with active false', async () => {
      await expect(
        handler(requestAs('owner1', { ...OWNER_CLAIMS, active: false }, data)),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    });

    test('refuses an Owner who skipped the second factor (SEC-05)', async () => {
      await expect(
        handler(requestAs('owner1', OWNER_CLAIMS, data, { secondFactor: false })),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    });

    test('refuses a forged Owner token for an account that is really Sales', async () => {
      await expect(handler(requestAs('sales1', OWNER_CLAIMS, data))).rejects.toMatchObject({
        code: 'permission-denied',
      });
    });

    test('refuses an Owner token issued before the account was turned off', async () => {
      await adminAuth().updateUser('owner1', { disabled: true });
      await expect(handler(asOwner(data))).rejects.toMatchObject({ code: 'permission-denied' });
    });

    test('refuses an Owner token issued before "sign out everywhere"', async () => {
      const authTime = nowSeconds() - 60;
      await adminAuth().revokeRefreshTokens('owner1');
      await expect(
        handler(requestAs('owner1', OWNER_CLAIMS, data, { authTime })),
      ).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    test('refuses malformed input', async () => {
      await expect(handler(asOwner({ ...data, extra: 'field' }))).rejects.toMatchObject({
        code: 'invalid-argument',
      });
      await expect(handler(asOwner(null))).rejects.toMatchObject({ code: 'invalid-argument' });
    });
  });
});

describe('createUser (AUTH-02, SEC-01)', () => {
  test('creates the account, claims, user document and audit log, and returns a reset link', async () => {
    const result = await createUserHandler(asOwner(newUser));

    const record = await adminAuth().getUser(result.uid);
    expect(record.email).toBe('jun@example.com');
    expect(record.customClaims).toEqual({ role: 'sales', branchId: 'main', active: true });
    expect(record.disabled).toBe(false);

    const doc = (await db().collection('users').doc(result.uid).get()).data();
    expect(doc).toMatchObject({
      displayName: 'Jun Reyes',
      email: 'jun@example.com',
      role: 'sales',
      userCode: 'JR',
      branchId: 'main',
      active: true,
    });
    expect(doc?.createdAt).toBeDefined();

    const [log] = await auditLogs('user.create');
    expect(log).toMatchObject({ actorId: 'owner1', branchId: 'main', targetId: result.uid });
    expect(JSON.stringify(log)).not.toContain('oobCode');

    expect(result.resetLink).toContain('oobCode');
  });

  test('always uses the caller’s own branch', async () => {
    const result = await createUserHandler(asOwner(newUser));
    expect((await adminAuth().getUser(result.uid)).customClaims?.branchId).toBe('main');
  });

  test('refuses a duplicate email', async () => {
    await createUserHandler(asOwner(newUser));
    await expect(createUserHandler(asOwner({ ...newUser, userCode: 'J2' }))).rejects.toMatchObject({
      code: 'already-exists',
    });
  });

  test('refuses a duplicate user code and leaves no half-made account', async () => {
    await createUserHandler(asOwner(newUser));
    await expect(
      createUserHandler(asOwner({ ...newUser, email: 'other@example.com' })),
    ).rejects.toMatchObject({ code: 'already-exists' });
    await expect(adminAuth().getUserByEmail('other@example.com')).rejects.toMatchObject({
      code: 'auth/user-not-found',
    });
  });
});

describe('setUserRole (AUTH-03)', () => {
  beforeEach(() => seedUser('sales1', { role: 'sales', branchId: 'main', active: true }));

  test('changes the claim and document, logs before and after, and revokes sessions', async () => {
    await setUserRoleHandler(asOwner({ uid: 'sales1', role: 'specialSales' }));

    const record = await adminAuth().getUser('sales1');
    expect(record.customClaims).toEqual({ role: 'specialSales', branchId: 'main', active: true });
    expect(record.tokensValidAfterTime).toBeDefined();
    expect((await db().collection('users').doc('sales1').get()).data()?.role).toBe('specialSales');

    const [log] = await auditLogs('user.setRole');
    expect(log).toMatchObject({
      actorId: 'owner1',
      targetId: 'sales1',
      before: { role: 'sales' },
      after: { role: 'specialSales' },
    });
  });

  test('refuses changing your own role', async () => {
    await expect(
      setUserRoleHandler(asOwner({ uid: 'owner1', role: 'sales' })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('cannot reach a user of another branch', async () => {
    await seedUser('other1', { role: 'sales', branchId: 'other', active: true });
    await expect(
      setUserRoleHandler(asOwner({ uid: 'other1', role: 'owner' })),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect((await adminAuth().getUser('other1')).customClaims?.role).toBe('sales');
  });

  test('refuses an unknown user', async () => {
    await expect(
      setUserRoleHandler(asOwner({ uid: 'ghost', role: 'sales' })),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('deactivateUser (SEC-04)', () => {
  beforeEach(() => seedUser('sales1', { role: 'sales', branchId: 'main', active: true }));

  test('disables the account, removes claims, revokes sessions, keeps the document', async () => {
    await deactivateUserHandler(asOwner({ uid: 'sales1', reason: 'Left the store' }));

    const record = await adminAuth().getUser('sales1');
    expect(record.disabled).toBe(true);
    expect(record.customClaims ?? {}).toEqual({});
    expect(record.tokensValidAfterTime).toBeDefined();

    const doc = (await db().collection('users').doc('sales1').get()).data();
    expect(doc?.active).toBe(false);

    const [log] = await auditLogs('user.deactivate');
    expect(log).toMatchObject({ actorId: 'owner1', targetId: 'sales1', reason: 'Left the store' });
  });

  test('refuses turning off your own account', async () => {
    await expect(deactivateUserHandler(asOwner({ uid: 'owner1' }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect((await adminAuth().getUser('owner1')).disabled).toBe(false);
  });
});

describe('signOutEverywhere (AUTH-04)', () => {
  test('revokes sessions without turning the account off, and logs it', async () => {
    await seedUser('sales1', { role: 'sales', branchId: 'main', active: true });
    await signOutEverywhereHandler(asOwner({ uid: 'sales1' }));

    const record = await adminAuth().getUser('sales1');
    expect(record.tokensValidAfterTime).toBeDefined();
    expect(record.disabled).toBe(false);
    expect(record.customClaims?.role).toBe('sales');
    expect(await auditLogs('user.signOutEverywhere')).toHaveLength(1);
  });
});

describe('createPasswordResetLink', () => {
  test('returns a link for an active user and logs the action, not the link', async () => {
    await seedUser('sales1', { role: 'sales', branchId: 'main', active: true });
    const result = await createPasswordResetLinkHandler(asOwner({ uid: 'sales1' }));
    expect(result.resetLink).toContain('oobCode');
    const [log] = await auditLogs('user.passwordResetLink');
    expect(JSON.stringify(log)).not.toContain('oobCode');
  });

  test('refuses a turned-off account', async () => {
    await seedUser('sales1', { role: 'sales', branchId: 'main', active: true }, { active: false });
    await expect(createPasswordResetLinkHandler(asOwner({ uid: 'sales1' }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });
});

describe('recordSignIn (SYS-03, SEC-02)', () => {
  const event = (customClaims: Claims | undefined) =>
    ({ data: { uid: 'sales1', customClaims } }) as unknown as AuthBlockingEvent;

  test('logs a sign-in by an account with a valid role', async () => {
    await recordSignInHandler(event({ role: 'sales', branchId: 'main', active: true }));
    const [log] = await auditLogs('auth.signIn');
    expect(log).toMatchObject({ actorId: 'sales1', branchId: 'main', targetId: 'sales1' });
  });

  test.each([
    ['no claims', undefined],
    ['active false', { role: 'sales', branchId: 'main', active: false }],
    ['unknown role', { role: 'admin', branchId: 'main', active: true }],
    ['no branch', { role: 'sales', active: true }],
  ])('blocks a sign-in with %s', async (_label, claims) => {
    await expect(recordSignInHandler(event(claims))).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(await auditLogs('auth.signIn')).toHaveLength(0);
  });
});
