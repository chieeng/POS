import { z } from 'zod';
import { ROLES } from '../lib/roles.js';

// Firebase Auth uids are up to 128 characters with no slashes.
const uid = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

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
