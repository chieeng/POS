import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const ROOT = resolve(import.meta.dirname, '../..');

export async function createTestEnvironment(): Promise<RulesTestEnvironment> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run these tests with `npm run test:emulators` from the repo root.');
  }
  return initializeTestEnvironment({
    projectId: 'demo-pos',
    firestore: { rules: readFileSync(resolve(ROOT, 'firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(resolve(ROOT, 'storage.rules'), 'utf8') },
  });
}

const TOTP = { firebase: { sign_in_second_factor: 'totp' } };

/** Every kind of caller the rules must handle (SEC-16). */
export function callers(env: RulesTestEnvironment) {
  const as = (uid: string, token?: Record<string, unknown>): RulesTestContext =>
    env.authenticatedContext(uid, token);
  const staff = (role: string, branchId = 'main') => ({ role, branchId, active: true });

  return {
    /** Someone with only the public web config. */
    noAccount: env.unauthenticatedContext(),
    /** A signed-in account that was never given claims. */
    noClaims: as('nobody'),
    /** Deactivated the SEC-04 way: claims removed, old uid. */
    deactivated: as('former1'),
    /** A stale token that still has a role but active false. */
    inactiveFlag: as('sales1', { role: 'sales', branchId: 'main', active: false }),
    /** A role this system does not have. */
    unknownRole: as('sales1', { role: 'admin', branchId: 'main', active: true }),
    sales: as('sales1', staff('sales')),
    specialSales: as('special1', staff('specialSales')),
    owner: as('owner1', { ...staff('owner'), ...TOTP }),
    /** Owner whose sign-in did not pass the authenticator step (SEC-05). */
    ownerWithoutSecondFactor: as('owner1', staff('owner')),
    /** A real Owner, but of a different branch. */
    otherBranchOwner: as('owner9', { ...staff('owner', 'other'), ...TOTP }),
  };
}

export type Callers = ReturnType<typeof callers>;
export type CallerName = keyof Callers;

export const NO_ACCESS: CallerName[] = [
  'noAccount',
  'noClaims',
  'deactivated',
  'inactiveFlag',
  'unknownRole',
  'ownerWithoutSecondFactor',
];

export const EVERYONE: CallerName[] = [
  ...NO_ACCESS,
  'sales',
  'specialSales',
  'owner',
  'otherBranchOwner',
];
