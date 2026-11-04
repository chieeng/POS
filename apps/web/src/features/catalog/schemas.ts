import { z } from 'zod';
import { isSoldByMeasure, parseQty } from '@/lib/quantity';
import { UNITS, type Unit } from './data';

// The server checks every value again (create_product, update_product and the table's
// constraints); these are for feedback while typing.
export const productSchema = z
  .object({
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
    reorderLevel: z.string().trim(),
  })
  // PROD-01: the reorder level is in the product's unit, so it takes decimals only in kg or L.
  .superRefine((values, context) => {
    const level = parseQty(values.reorderLevel, values.unit);
    if (level === null) {
      context.addIssue({
        code: 'custom',
        path: ['reorderLevel'],
        message: isSoldByMeasure(values.unit)
          ? `Enter a number of ${values.unit}, up to 3 decimals.`
          : 'Enter a whole number.',
      });
    } else if (level > 1_000_000) {
      context.addIssue({
        code: 'custom',
        path: ['reorderLevel'],
        message: 'Use at most 1,000,000.',
      });
    }
  });
export type ProductValues = z.infer<typeof productSchema>;

export const UNIT_LABELS: Record<Unit, string> = {
  pc: 'pc (piece)',
  pack: 'pack',
  box: 'box',
  bottle: 'bottle',
  can: 'can',
  sachet: 'sachet',
  set: 'set',
  pair: 'pair',
  roll: 'roll',
  kg: 'kg (kilogram)',
  L: 'L (litre)',
};
