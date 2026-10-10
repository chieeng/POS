import { z } from 'zod';

export const signInSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').pipe(z.email('Enter a valid email.')),
  password: z.string().min(1, 'Enter your password.'),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});
export type TotpCodeValues = z.infer<typeof totpCodeSchema>;

// SEC-05: the same minimum Supabase Auth enforces on the server.
export const PASSWORD_MIN_LENGTH = 10;

export const newPasswordSchema = z.object({
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(72, 'Use 72 characters or fewer.'),
});
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;

export const unlockSchema = z.object({
  password: z.string().min(1, 'Enter your password.'),
});
export type UnlockValues = z.infer<typeof unlockSchema>;
