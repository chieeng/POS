import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import { callers, createTestEnvironment, EVERYONE, NO_ACCESS, type Callers } from './helpers';

let env: RulesTestEnvironment;
let who: Callers;

const userDoc = (role: string, branchId = 'main') => ({
  displayName: 'Test',
  email: 't@example.com',
  role,
  userCode: 'T1',
  branchId,
  active: true,
});

beforeAll(async () => {
  env = await createTestEnvironment();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  who = callers(env);
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    await setDoc(doc(db, 'users/owner1'), userDoc('owner'));
    await setDoc(doc(db, 'users/sales1'), userDoc('sales'));
    await setDoc(doc(db, 'users/special1'), userDoc('specialSales'));
    await setDoc(doc(db, 'users/former1'), { ...userDoc('sales'), active: false });
    await setDoc(doc(db, 'users/nobody'), userDoc('sales'));
    await setDoc(doc(db, 'users/owner9'), userDoc('owner', 'other'));
    await setDoc(doc(db, 'users/sales9'), userDoc('sales', 'other'));
    await setDoc(doc(db, 'auditLogs/log1'), {
      action: 'user.create',
      actorId: 'owner1',
      branchId: 'main',
      targetType: 'user',
      targetId: 'sales1',
    });
    await setDoc(doc(db, 'auditLogs/log9'), {
      action: 'user.create',
      actorId: 'owner9',
      branchId: 'other',
      targetType: 'user',
      targetId: 'sales9',
    });
    await setDoc(doc(db, 'products/p1'), { name: 'Rice', branchId: 'main' });
    await setDoc(doc(db, 'branches/main'), { name: 'Store' });
  });
});

describe('users', () => {
  test.each(['sales', 'specialSales', 'owner'] as const)(
    '%s reads their own profile',
    async (name) => {
      const uid = { sales: 'sales1', specialSales: 'special1', owner: 'owner1' }[name];
      await assertSucceeds(getDoc(doc(who[name].firestore(), `users/${uid}`)));
    },
  );

  test.each(NO_ACCESS)('%s cannot read any profile, not even their own', async (name) => {
    const db = who[name].firestore();
    for (const uid of ['sales1', 'owner1', 'nobody', 'former1']) {
      await assertFails(getDoc(doc(db, `users/${uid}`)));
    }
  });

  test.each(['sales', 'specialSales'] as const)('%s cannot read someone else', async (name) => {
    await assertFails(getDoc(doc(who[name].firestore(), 'users/owner1')));
    await assertFails(getDoc(doc(who[name].firestore(), 'users/former1')));
  });

  test('the Owner reads profiles of their branch only', async () => {
    const db = who.owner.firestore();
    await assertSucceeds(getDoc(doc(db, 'users/sales1')));
    await assertSucceeds(getDoc(doc(db, 'users/former1')));
    await assertFails(getDoc(doc(db, 'users/sales9')));
    await assertFails(getDoc(doc(who.otherBranchOwner.firestore(), 'users/sales1')));
  });

  test('the Owner lists their branch with a limit; nothing broader', async () => {
    const users = collection(who.owner.firestore(), 'users');
    await assertSucceeds(getDocs(query(users, where('branchId', '==', 'main'), limit(100))));
    await assertFails(getDocs(query(users, where('branchId', '==', 'main'))));
    await assertFails(getDocs(query(users, where('branchId', '==', 'main'), limit(101))));
    await assertFails(getDocs(query(users, where('branchId', '==', 'other'), limit(100))));
    await assertFails(getDocs(query(users, limit(100))));
  });

  test.each(['sales', 'specialSales', ...NO_ACCESS] as const)(
    '%s cannot list users',
    async (name) => {
      const users = collection(who[name].firestore(), 'users');
      await assertFails(getDocs(query(users, where('branchId', '==', 'main'), limit(10))));
    },
  );

  test.each(EVERYONE)('%s cannot create, change or delete a profile', async (name) => {
    const db = who[name].firestore();
    await assertFails(setDoc(doc(db, 'users/new1'), userDoc('owner')));
    await assertFails(updateDoc(doc(db, 'users/sales1'), { role: 'owner' }));
    await assertFails(updateDoc(doc(db, 'users/sales1'), { active: true }));
    await assertFails(updateDoc(doc(db, 'users/owner1'), { displayName: 'x' }));
    await assertFails(deleteDoc(doc(db, 'users/sales1')));
  });

  test('device records are closed until device tags are built', async () => {
    const db = who.sales.firestore();
    await assertFails(getDoc(doc(db, 'users/sales1/devices/d1')));
    await assertFails(setDoc(doc(db, 'users/sales1/devices/d1'), { deviceTag: 'A1' }));
  });
});

describe('auditLogs', () => {
  test('the Owner reads and lists the logs of their branch', async () => {
    const db = who.owner.firestore();
    await assertSucceeds(getDoc(doc(db, 'auditLogs/log1')));
    await assertFails(getDoc(doc(db, 'auditLogs/log9')));
    const logs = collection(db, 'auditLogs');
    await assertSucceeds(getDocs(query(logs, where('branchId', '==', 'main'), limit(200))));
    await assertFails(getDocs(query(logs, where('branchId', '==', 'main'))));
    await assertFails(getDocs(query(logs, limit(50))));
  });

  test.each(['sales', 'specialSales', 'otherBranchOwner', ...NO_ACCESS] as const)(
    '%s cannot read the audit log',
    async (name) => {
      const db = who[name].firestore();
      await assertFails(getDoc(doc(db, 'auditLogs/log1')));
      await assertFails(
        getDocs(query(collection(db, 'auditLogs'), where('branchId', '==', 'main'), limit(10))),
      );
    },
  );

  test.each(EVERYONE)('%s cannot write, change or delete audit logs', async (name) => {
    const db = who[name].firestore();
    await assertFails(
      addDoc(collection(db, 'auditLogs'), { action: 'x', actorId: 'owner1', branchId: 'main' }),
    );
    await assertFails(updateDoc(doc(db, 'auditLogs/log1'), { action: 'edited' }));
    await assertFails(deleteDoc(doc(db, 'auditLogs/log1')));
  });
});

describe('default deny', () => {
  const paths = ['products/p1', 'branches/main', 'sales/s1', 'payRates/sales1', 'anything/else'];

  test.each(EVERYONE)('%s can read and write nothing else', async (name) => {
    const db = who[name].firestore();
    for (const path of paths) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { branchId: 'main', hacked: true }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    await assertFails(getDocs(query(collection(db, 'products'), limit(1))));
  });
});
