import { z } from 'zod';

export const ROLES = ['owner', 'special_sales', 'sales'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  'create',
  'update',
  'setRole',
  'deactivate',
  'signOutEverywhere',
  'passwordResetLink',
] as const;
export type Action = (typeof ACTIONS)[number];

// Supabase Auth user ids are UUIDs.
const uid = z.uuid();

const role = z.enum(ROLES);

// SYS-02: the calling device's tag, recorded in the audit log. Informational only: it is
// reported by the client and never used for any access decision.
const deviceTag = z
  .string()
  .regex(/^[A-Z0-9]{4}$/)
  .optional();

const displayName = z.string().trim().min(1).max(80);

// Short code that prefixes this person's receipt numbers (POS-08).
const userCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,6}$/, 'Use 2 to 6 letters or digits.');

export const createUserSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  displayName,
  role,
  userCode,
  deviceTag,
});

export const setUserRoleSchema = z.strictObject({ uid, role, deviceTag });

// AUTH-02: the Owner edits a user's name and user code.
export const updateUserSchema = z
  .strictObject({
    uid,
    displayName: displayName.optional(),
    userCode: userCode.optional(),
    deviceTag,
  })
  .refine((value) => value.displayName !== undefined || value.userCode !== undefined, {
    message: 'Nothing to change.',
  });

export const deactivateUserSchema = z.strictObject({
  uid,
  reason: z.string().trim().min(1).max(200).optional(),
  deviceTag,
});

export const userIdSchema = z.strictObject({ uid, deviceTag });

/** The request body: which action, and that action's own input. Nothing else is accepted. */
export const requestSchema = z.strictObject({
  action: z.enum(ACTIONS),
  input: z.unknown(),
});
