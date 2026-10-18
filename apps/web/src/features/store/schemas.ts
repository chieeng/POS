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
