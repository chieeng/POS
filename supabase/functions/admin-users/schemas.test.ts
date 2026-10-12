import { assert, assertEquals, assertFalse } from '@std/assert';
import {
  createUserSchema,
  deactivateUserSchema,
  requestSchema,
  setUserRoleSchema,
  updateUserSchema,
  userIdSchema,
} from './schemas.ts';

const valid = {
  email: 'Jun.Reyes@Example.com ',
  displayName: ' Jun Reyes ',
  role: 'sales',
  userCode: 'jr1',
};
const UID = '3f2c1a9e-5b7d-4c1e-9a3f-0d2b6e8c4a10';

Deno.test('createUserSchema normalises email, name and user code', () => {
  assertEquals(createUserSchema.parse(valid), {
    email: 'jun.reyes@example.com',
    displayName: 'Jun Reyes',
    role: 'sales',
    userCode: 'JR1',
  });
});

Deno.test('createUserSchema rejects unknown roles', () => {
  assertFalse(createUserSchema.safeParse({ ...valid, role: 'admin' }).success);
  assertFalse(createUserSchema.safeParse({ ...valid, role: 'specialSales' }).success);
});

Deno.test('createUserSchema rejects extra fields such as a branch, uid or password', () => {
  for (const extra of [
    { branchId: 'other' },
    { branch_id: 'other' },
    { uid: UID },
    { password: 'password12' },
    { active: true },
  ]) {
    assertFalse(createUserSchema.safeParse({ ...valid, ...extra }).success);
  }
});

for (const userCode of ['', 'J', 'TOOLONG7', 'J-R', 'J R']) {
  Deno.test(`createUserSchema rejects user code ${JSON.stringify(userCode)}`, () => {
    assertFalse(createUserSchema.safeParse({ ...valid, userCode }).success);
  });
}

for (const email of ['', 'not-an-email', 'a@']) {
  Deno.test(`createUserSchema rejects email ${JSON.stringify(email)}`, () => {
    assertFalse(createUserSchema.safeParse({ ...valid, email }).success);
  });
}

Deno.test('createUserSchema rejects an empty or oversized name', () => {
  assertFalse(createUserSchema.safeParse({ ...valid, displayName: '   ' }).success);
  assertFalse(createUserSchema.safeParse({ ...valid, displayName: 'x'.repeat(81) }).success);
});

for (const uid of ['', 'a/b', '../x', 'x'.repeat(129), 'owner1', `${UID}'--`]) {
  Deno.test(`uid inputs reject ${JSON.stringify(uid.slice(0, 40))}`, () => {
    assertFalse(userIdSchema.safeParse({ uid }).success);
    assertFalse(setUserRoleSchema.safeParse({ uid, role: 'sales' }).success);
    assertFalse(deactivateUserSchema.safeParse({ uid }).success);
    assertFalse(updateUserSchema.safeParse({ uid, displayName: 'x' }).success);
  });
}

Deno.test('non-object input is rejected', () => {
  for (const data of [null, undefined, 'uid', 42, []]) {
    assertFalse(userIdSchema.safeParse(data).success);
  }
});

Deno.test('deactivate accepts an optional reason up to 200 characters', () => {
  assert(deactivateUserSchema.safeParse({ uid: UID }).success);
  assert(deactivateUserSchema.safeParse({ uid: UID, reason: 'Left the store' }).success);
  assertFalse(deactivateUserSchema.safeParse({ uid: UID, reason: 'x'.repeat(201) }).success);
});

Deno.test('update needs something to change and accepts nothing but name and code', () => {
  assertFalse(updateUserSchema.safeParse({ uid: UID }).success);
  assert(updateUserSchema.safeParse({ uid: UID, displayName: 'New Name' }).success);
  for (const extra of [{ role: 'owner' }, { active: false }, { branchId: 'other' }]) {
    assertFalse(updateUserSchema.safeParse({ uid: UID, displayName: 'x', ...extra }).success);
  }
});

Deno.test('the device tag is four capital letters or digits', () => {
  assert(userIdSchema.safeParse({ uid: UID, deviceTag: 'A1B2' }).success);
  for (const deviceTag of ['a1b2', 'A1B', 'A1B2C', '<b>!']) {
    assertFalse(userIdSchema.safeParse({ uid: UID, deviceTag }).success);
  }
});

Deno.test('the request names a known action and nothing else', () => {
  assert(requestSchema.safeParse({ action: 'create', input: {} }).success);
  assertFalse(requestSchema.safeParse({ action: 'delete', input: {} }).success);
  assertFalse(requestSchema.safeParse({ action: 'create', input: {}, as: 'owner' }).success);
  assertFalse(requestSchema.safeParse(null).success);
});
