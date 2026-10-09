import { describe, expect, test } from 'vitest';
import { createUserSchema, deactivateUserSchema, setUserRoleSchema, userIdSchema } from './schemas';

describe('createUserSchema', () => {
  const valid = {
    email: 'Jun.Reyes@Example.com ',
    displayName: ' Jun Reyes ',
    role: 'sales',
    userCode: 'jr1',
  };

  test('normalises email, name and user code', () => {
    expect(createUserSchema.parse(valid)).toEqual({
      email: 'jun.reyes@example.com',
      displayName: 'Jun Reyes',
      role: 'sales',
      userCode: 'JR1',
    });
  });

  test('rejects unknown roles', () => {
    expect(createUserSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
  });

  test('rejects extra fields such as a caller-chosen branch, uid or password', () => {
    for (const extra of [
      { branchId: 'other' },
      { uid: 'x' },
      { password: 'password12' },
      { active: true },
    ]) {
      expect(createUserSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });

  test.each(['', 'J', 'TOOLONG7', 'J-R', 'J R'])('rejects user code %j', (userCode) => {
    expect(createUserSchema.safeParse({ ...valid, userCode }).success).toBe(false);
  });

  test.each(['', 'not-an-email', 'a@'])('rejects email %j', (email) => {
    expect(createUserSchema.safeParse({ ...valid, email }).success).toBe(false);
  });

  test('rejects an empty or oversized name', () => {
    expect(createUserSchema.safeParse({ ...valid, displayName: '   ' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...valid, displayName: 'x'.repeat(81) }).success).toBe(
      false,
    );
  });
});

describe('uid inputs', () => {
  test.each(['', 'a/b', '../x', 'x'.repeat(129)])('reject uid %j', (uid) => {
    expect(userIdSchema.safeParse({ uid }).success).toBe(false);
    expect(setUserRoleSchema.safeParse({ uid, role: 'sales' }).success).toBe(false);
    expect(deactivateUserSchema.safeParse({ uid }).success).toBe(false);
  });

  test('non-object input is rejected', () => {
    for (const data of [null, undefined, 'uid', 42, []]) {
      expect(userIdSchema.safeParse(data).success).toBe(false);
    }
  });

  test('deactivate accepts an optional reason up to 200 characters', () => {
    expect(deactivateUserSchema.safeParse({ uid: 'abc' }).success).toBe(true);
    expect(deactivateUserSchema.safeParse({ uid: 'abc', reason: 'Left the store' }).success).toBe(
      true,
    );
    expect(deactivateUserSchema.safeParse({ uid: 'abc', reason: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });
});
