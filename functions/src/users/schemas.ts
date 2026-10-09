import { z } from 'zod';
import { ROLES } from '../lib/roles.js';

// Firebase Auth uids are up to 128 characters with no slashes.
const uid = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const role = z.enum(ROLES);

export const createUserSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  displayName: z.string().trim().min(1).max(80),
  role,
  // Short code that prefixes this person's receipt numbers (POS-08).
  userCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, 'Use 2 to 6 letters or digits.'),
});

export const setUserRoleSchema = z.strictObject({ uid, role });

export const deactivateUserSchema = z.strictObject({
  uid,
  reason: z.string().trim().min(1).max(200).optional(),
});

export const userIdSchema = z.strictObject({ uid });
