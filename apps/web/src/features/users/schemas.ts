import { z } from 'zod';

// Mirrors supabase/functions/admin-users/schemas.ts. The server validates again; this is for feedback.
const displayName = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(80, 'Use 80 characters or fewer.');
const userCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,6}$/, 'Use 2 to 6 letters or digits.');

export const addUserSchema = z.object({
  displayName,
  email: z.string().trim().min(1, 'Enter an email.').pipe(z.email('Enter a valid email.')),
  role: z.enum(['sales', 'special_sales']),
  userCode,
});
export type AddUserValues = z.infer<typeof addUserSchema>;

export const editUserSchema = z.object({ displayName, userCode });
export type EditUserValues = z.infer<typeof editUserSchema>;

export const STAFF_ROLE_OPTIONS = [
  { value: 'sales', label: 'Sales' },
  { value: 'special_sales', label: 'Special Sales' },
] as const;
