import { z } from 'zod';
import { parseCoordinates } from './geo';

// The server checks every value again (update_branch_settings and the table's constraints);
// these are for feedback while typing. Every field is text, as the inputs give it.
const optionalText = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);

export const storeDetailsSchema = z.object({
  name: z.string().trim().min(1, 'Enter the store name.').max(120, 'Use 120 characters or fewer.'),
  address: optionalText(200),
  contact: optionalText(80),
  tin: z
    .string()
    .trim()
    .regex(
      /^$|^[0-9]{3}-?[0-9]{3}-?[0-9]{3}(-?[0-9]{3,5})?$/,
      'Use the TIN format, for example 123-456-789-000.',
    ),
  receiptFooter: optionalText(300),
  discountLimit: z
    .string()
    .trim()
    .regex(/^$|^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount in pesos, for example 50 or 50.00.'),
  idleLockMinutes: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Enter whole minutes.')
    .refine((value) => Number(value) >= 1 && Number(value) <= 240, 'Use 1 to 240 minutes.'),
});
export type StoreDetailsValues = z.infer<typeof storeDetailsSchema>;

export const storeLocationSchema = z.object({
  coordinates: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || parseCoordinates(value) !== null,
      'Enter latitude and longitude, for example 14.599512, 120.984219.',
    ),
  radius: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, 'Enter whole metres.')
    .refine((value) => Number(value) >= 10 && Number(value) <= 2000, 'Use 10 to 2000 metres.'),
});
export type StoreLocationValues = z.infer<typeof storeLocationSchema>;

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time, for example 06:00.');

export const LATE_DEDUCTION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'minutes', label: 'Minutes late' },
  { value: 'flat', label: 'Flat amount' },
] as const;

export const attendanceSchema = z
  .object({
    morningClockIn: clockTime,
    afternoonClockIn: clockTime,
    graceMinutes: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, 'Enter whole minutes.')
      .refine((value) => Number(value) <= 120, 'Use 0 to 120 minutes.'),
    lateDeduction: z.enum(['none', 'minutes', 'flat']),
    latePenalty: z
      .string()
      .trim()
      .regex(/^\d{1,5}(\.\d{1,2})?$/, 'Enter an amount in pesos, for example 50 or 50.00.')
      .refine((value) => Number(value) <= 10000, 'Use at most ₱10,000.'),
    paidHours: z
      .string()
      .trim()
      .regex(/^\d{1,2}(\.\d{1,2})?$/, 'Enter hours, for example 8 or 8.5.')
      .refine((value) => Number(value) >= 1 && Number(value) <= 24, 'Use 1 to 24 hours.'),
    afternoonDayCredit: z.enum(['0.5', '1']),
    ownerClocksIn: z.enum(['no', 'yes']),
  })
  .refine((values) => values.afternoonClockIn > values.morningClockIn, {
    path: ['afternoonClockIn'],
    message: 'The afternoon shift must start after the morning shift.',
  });
export type AttendanceValues = z.infer<typeof attendanceSchema>;
