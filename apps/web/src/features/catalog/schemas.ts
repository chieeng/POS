import { z } from 'zod';
import { UNITS } from './data';

// The server checks every value again (create_product, update_product and the table's
// constraints); these are for feedback while typing.
export const productSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/, 'Use 1 to 20 letters, digits or dashes.'),
  name: z
    .string()
    .trim()
    .min(1, 'Enter the product name.')
    .max(120, 'Use 120 characters or fewer.'),
  categoryId: z.string().min(1, 'Choose a category.'),
  unit: z.enum(UNITS),
  sellPrice: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter a price in pesos, for example 45 or 45.50.')
    .refine(
      (value) => Number(value) >= 0.01 && Number(value) <= 1_000_000,
      'Use ₱0.01 to ₱1,000,000.',
    ),
  reorderLevel: z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, 'Enter a whole number.')
    .refine((value) => Number(value) <= 1_000_000, 'Use at most 1,000,000.'),
});
export type ProductValues = z.infer<typeof productSchema>;

export const UNIT_LABELS: Record<(typeof UNITS)[number], string> = {
  pc: 'pc (piece)',
  pack: 'pack',
  box: 'box',
  bottle: 'bottle',
  can: 'can',
  sachet: 'sachet',
  set: 'set',
  pair: 'pair',
  roll: 'roll',
};
