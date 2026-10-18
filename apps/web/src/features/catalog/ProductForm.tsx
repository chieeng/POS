import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UNITS, type Category } from './data';
import { selectClass } from './helpers';
import { productSchema, UNIT_LABELS, type ProductValues } from './schemas';

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-[5px] text-[13px] text-danger-fg">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-[5px] text-[12.5px] text-neutral-700">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const describedBy = (id: string, error: unknown, hint: boolean) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

interface ProductFormProps {
  defaultValues: ProductValues;
  categories: Category[];
  /** The product's current category, kept as a choice even if it is now inactive. */
  currentCategoryId?: string;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: ProductValues) => Promise<void>;
  onCancel?: () => void;
}

/** Add product and the Owner's edit (PROD-01). Only active categories can be chosen. */
export function ProductForm({
  defaultValues,
  categories,
  currentCategoryId,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductValues>({ resolver: zodResolver(productSchema), defaultValues });

  const choices = categories
    .filter((category) => category.active || category.id === currentCategoryId)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-[14px] rounded-[30px] bg-surface px-[18px] py-[18px] md:px-[22px]"
    >
      <Field
        id="product-name"
        label="Product name"
        hint="As staff will search for it, for example “Chips Classic 60 g”."
        error={errors.name?.message}
      >
        <Input
          id="product-name"
          autoComplete="off"
          className="min-h-[48px] bg-bg text-[15px]"
          aria-invalid={!!errors.name || undefined}
          aria-describedby={describedBy('product-name', errors.name, true)}
          {...register('name')}
        />
      </Field>
      <Field
        id="product-sku"
        label="SKU"
        hint="The product code: 1 to 20 letters, digits or dashes. Saved in capitals; no two products can share one."
        error={errors.sku?.message}
      >
        <Input
          id="product-sku"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          className="min-h-[48px] max-w-[260px] bg-bg text-[15px] font-semibold uppercase"
          aria-invalid={!!errors.sku || undefined}
          aria-describedby={describedBy('product-sku', errors.sku, true)}
          {...register('sku')}
        />
      </Field>
      <Field
        id="product-category"
        label="Category"
        hint={choices.length === 0 ? 'Add a category first, under Categories.' : undefined}
        error={errors.categoryId?.message}
      >
        <select
          id="product-category"
          className={selectClass}
          aria-invalid={!!errors.categoryId || undefined}
          aria-describedby={describedBy(
            'product-category',
            errors.categoryId,
            choices.length === 0,
          )}
          {...register('categoryId')}
        >
          <option value="">Choose a category</option>
          {choices.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.active ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-[14px] sm:grid-cols-2">
        <Field
          id="product-unit"
          label="Unit"
          hint="The price and every quantity are per this unit."
          error={errors.unit?.message}
        >
          <select
            id="product-unit"
            className={selectClass}
            aria-describedby={describedBy('product-unit', errors.unit, true)}
            {...register('unit')}
          >
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {UNIT_LABELS[unit]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="product-price" label="Selling price (₱)" error={errors.sellPrice?.message}>
          <Input
            id="product-price"
            inputMode="decimal"
            autoComplete="off"
            className="min-h-[48px] bg-bg text-[15px]"
            aria-invalid={!!errors.sellPrice || undefined}
            aria-describedby={describedBy('product-price', errors.sellPrice, false)}
            {...register('sellPrice')}
          />
        </Field>
      </div>
      <Field
        id="product-reorder"
        label="Reorder level"
        hint="When stock falls to this, the product shows as low stock. 0 turns it off."
        error={errors.reorderLevel?.message}
      >
        <Input
          id="product-reorder"
          inputMode="numeric"
          autoComplete="off"
          className="min-h-[48px] max-w-[160px] bg-bg text-[15px]"
          aria-invalid={!!errors.reorderLevel || undefined}
          aria-describedby={describedBy('product-reorder', errors.reorderLevel, true)}
          {...register('reorderLevel')}
        />
      </Field>
      <div className="flex flex-wrap gap-[10px]">
        <Button type="submit" className="min-h-[46px] px-[22px]" disabled={isSubmitting}>
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            className="min-h-[46px] px-[18px]"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
