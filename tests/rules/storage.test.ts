import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadString } from 'firebase/storage';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { callers, createTestEnvironment, EVERYONE, type Callers } from './helpers';

let env: RulesTestEnvironment;
let who: Callers;

beforeAll(async () => {
  env = await createTestEnvironment();
  who = callers(env);
});

afterAll(async () => {
  await env.cleanup();
});

describe('storage is closed until product photos are built (SEC-09)', () => {
  test.each(EVERYONE)('%s can read and upload nothing', async (name) => {
    const storage = who[name].storage();
    await assertFails(getBytes(ref(storage, 'products/main/p1.jpg')));
    await assertFails(uploadString(ref(storage, 'products/main/p1.jpg'), 'data'));
    await assertFails(uploadString(ref(storage, 'anything.txt'), 'data'));
  });
});
