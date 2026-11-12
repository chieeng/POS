import { Plus } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Tag } from '@/components/ui/tag';
import { useCategories, useProducts, type Product } from '@/features/catalog/data';
import { matchesSearch } from '@/features/catalog/helpers';
import { ICON_STROKE } from '@/lib/utils';
import {
  createDiscount,
  describeDiscountError,
  sortRules,
  updateDiscount,
  useDiscounts,
  type DiscountFields,
} from './data';
import {
  ruleAmount,
  targetText,
  type DiscountKind,
  type DiscountRule,
  type DiscountTarget,
} from './rules';

const sectionClass =
  'flex flex-col gap-[14px] rounded-[30px] bg-surface px-[18px] py-[18px] md:px-[22px]';
const headingClass = 'font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase';
const inputClass = 'min-h-[48px] bg-bg text-[15px]';

const KINDS = [
  { value: 'percent', label: 'Percent' },
  { value: 'fixed', label: '₱ off each unit' },
] as const;

const TARGETS = [
  { value: 'all', label: 'Every product' },
  { value: 'categories', label: 'Categories' },
  { value: 'products', label: 'Products' },
] as const;

// Products listed at a time while choosing; the search narrows them.
const PRODUCT_PICKS = 30;

/**
 * POS-03 and SYS-01 in Store settings: the Owner's preset discounts. Staff pick one per cart
 * line and never type a discount. A preset is switched off, never deleted, so past sales keep
 * pointing at it. No design exists for this section: it follows the GCash and Maya accounts.
 */
export function DiscountsSection() {
  const discounts = useDiscounts();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = sortRules(discounts.data);

  const setActive = async (rule: DiscountRule, active: boolean) => {
    setError(null);
    setBusyId(rule.id);
    try {
      await updateDiscount(rule.id, { active });
    } catch (caught) {
      setError(describeDiscountError(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={sectionClass} aria-labelledby="discounts-heading">
      <h2 id="discounts-heading" className={headingClass}>
        Preset discounts
      </h2>
      <p className="text-[13.5px] text-neutral-700">
        Staff never type a discount. They pick one of these on a cart line, one per line. A percent
        comes off the line total to the centavo; a peso amount comes off each unit (each kg or L)
        and is not offered on products priced at or below it.
      </p>
      {error && <Alert variant="danger">{error}</Alert>}

      {discounts.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the discounts.</b> Check your connection and reload.
        </Alert>
      ) : discounts.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : list.length === 0 ? (
        !adding && <p className="text-[14px] text-neutral-700">No discounts yet.</p>
      ) : (
        <ul aria-label="Preset discounts" className="flex flex-col">
          {list.map((rule) => (
            <li
              key={rule.id}
              aria-label={rule.name}
              className="flex flex-col gap-[10px] border-b border-text/8 py-[10px] last:border-b-0"
            >
              {editingId === rule.id ? (
                <DiscountForm
                  rule={rule}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-[10px]">
                  <span
                    className={rule.active ? 'min-w-0 flex-1' : 'min-w-0 flex-1 text-neutral-700'}
                  >
                    <b className="block text-[15px]">{rule.name}</b>
                    <span className="block text-[13.5px]">
                      {ruleAmount(rule)} · {targetText(rule)}
                    </span>
                  </span>
                  {!rule.active && <Tag variant="muted">Off</Tag>}
                  <Button
                    needsInternet
                    variant="secondary"
                    className="min-h-[44px] px-[14px]"
                    aria-label={`Edit ${rule.name}`}
                    onClick={() => {
                      setError(null);
                      setAdding(false);
                      setEditingId(rule.id);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    needsInternet
                    variant="secondary"
                    className="min-h-[44px] px-[14px]"
                    aria-label={`${rule.active ? 'Switch off' : 'Switch on'} ${rule.name}`}
                    disabled={busyId === rule.id}
                    onClick={() => void setActive(rule, !rule.active)}
                  >
                    {rule.active ? 'Switch off' : 'Switch on'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <DiscountForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <Button
          needsInternet
          variant="secondary"
          className="min-h-[46px] self-start px-[18px]"
          onClick={() => {
            setError(null);
            setEditingId(null);
            setAdding(true);
          }}
        >
          <Plus size={17} strokeWidth={ICON_STROKE} aria-hidden />
          Add discount
        </Button>
      )}
      <p className="text-[12.5px] text-neutral-700">
        Senior citizen and PWD discounts are not presets: they also change the VAT and need the
        customer&apos;s ID, which comes later.
      </p>
    </section>
  );
}

/** A peso or percent amount with at most 2 decimals; null when it isn't one. */
function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

/** Add a preset, or change one. */
function DiscountForm({
  rule,
  onDone,
  onCancel,
}: {
  rule?: DiscountRule;
  onDone: () => void;
  onCancel: () => void;
}) {
  const prefix = rule ? `discount-${rule.id}` : 'discount-new';
  const [name, setName] = useState(rule?.name ?? '');
  const [kind, setKind] = useState<DiscountKind>(rule?.kind ?? 'percent');
  const [value, setValue] = useState(rule ? String(rule.value) : '');
  const [target, setTarget] = useState<DiscountTarget>(rule?.appliesTo ?? 'all');
  const [categoryIds, setCategoryIds] = useState<string[]>(rule?.categoryIds ?? []);
  const [productIds, setProductIds] = useState<string[]>(rule?.productIds ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseAmount(value);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the discount a name staff will recognise.';
    if (amount === null || (kind === 'percent' && amount > 100)) {
      next.value =
        kind === 'percent'
          ? 'Enter a percent from 0.01 to 100.'
          : 'Enter the pesos off each unit, for example 5 or 2.50.';
    }
    if (target === 'categories' && categoryIds.length === 0)
      next.targets = 'Choose at least one category.';
    if (target === 'products' && productIds.length === 0)
      next.targets = 'Choose at least one product.';
    setErrors(next);
    if (Object.keys(next).length > 0 || amount === null) return;

    const fields: DiscountFields = {
      name: name.trim(),
      kind,
      value: amount,
      applies_to: target,
      category_ids: target === 'categories' ? categoryIds : [],
      product_ids: target === 'products' ? productIds : [],
    };
    setSaving(true);
    setError(null);
    try {
      if (rule) await updateDiscount(rule.id, fields);
      else await createDiscount(fields);
      onDone();
    } catch (caught) {
      setError(describeDiscountError(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label={rule ? `Edit ${rule.name}` : 'Add a discount'}
      className="flex flex-col gap-[12px] rounded-[22px] bg-bg px-[14px] py-[14px]"
    >
      {error && <Alert variant="danger">{error}</Alert>}
      <div>
        <Label htmlFor={`${prefix}-name`} className="text-[13px]">
          Name
        </Label>
        <Input
          id={`${prefix}-name`}
          autoComplete="off"
          maxLength={40}
          placeholder="For example: Suki 10%"
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={!!errors.name || undefined}
          aria-describedby={errors.name ? `${prefix}-name-error` : undefined}
        />
        {errors.name && (
          <p id={`${prefix}-name-error`} className="mt-[5px] text-[13px] text-danger-fg">
            {errors.name}
          </p>
        )}
      </div>
      <Segmented
        label="Kind"
        options={KINDS}
        value={kind}
        onChange={(next) => setKind(next as DiscountKind)}
      />
      <div>
        <Label htmlFor={`${prefix}-value`} className="text-[13px]">
          {kind === 'percent' ? 'Percent off' : 'Pesos off each unit (each kg or L)'}
        </Label>
        <Input
          id={`${prefix}-value`}
          inputMode="decimal"
          autoComplete="off"
          placeholder={kind === 'percent' ? '10' : '5.00'}
          className={inputClass}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={!!errors.value || undefined}
          aria-describedby={errors.value ? `${prefix}-value-error` : undefined}
        />
        {errors.value && (
          <p id={`${prefix}-value-error`} className="mt-[5px] text-[13px] text-danger-fg">
            {errors.value}
          </p>
        )}
      </div>
      <Segmented
        label="Applies to"
        options={TARGETS}
        value={target}
        onChange={(next) => setTarget(next as DiscountTarget)}
      />
      {target === 'categories' && <CategoryChoice chosen={categoryIds} onChange={setCategoryIds} />}
      {target === 'products' && <ProductChoice chosen={productIds} onChange={setProductIds} />}
      {errors.targets && <p className="text-[13px] text-danger-fg">{errors.targets}</p>}
      <div className="flex flex-wrap gap-[10px]">
        <Button needsInternet type="submit" className="min-h-[46px] px-[20px]" disabled={saving}>
          {saving ? 'Saving…' : rule ? 'Save discount' : 'Add discount'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[46px] px-[18px]"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

const toggle = (list: string[], id: string, on: boolean) =>
  on ? [...new Set([...list, id])] : list.filter((each) => each !== id);

function CategoryChoice({
  chosen,
  onChange,
}: {
  chosen: string[];
  onChange: (ids: string[]) => void;
}) {
  const categories = useCategories();
  const list = categories.data
    .filter((category) => category.active || chosen.includes(category.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-[4px] text-[13px]">Categories ({chosen.length} chosen)</legend>
      {list.length === 0 ? (
        <p className="text-[13.5px] text-neutral-700">No categories yet.</p>
      ) : (
        list.map((category) => (
          <CheckboxField
            key={category.id}
            label={category.name}
            checked={chosen.includes(category.id)}
            onCheckedChange={(on) => onChange(toggle(chosen, category.id, on === true))}
          />
        ))
      )}
    </fieldset>
  );
}

function ProductChoice({
  chosen,
  onChange,
}: {
  chosen: string[];
  onChange: (ids: string[]) => void;
}) {
  const products = useProducts();
  const [search, setSearch] = useState('');
  const matches = useMemo(() => {
    const picked = (product: Product) => chosen.includes(product.id);
    return products.data
      .filter((product) => picked(product) || (product.active && matchesSearch(product, search)))
      .sort((a, b) => Number(picked(b)) - Number(picked(a)))
      .slice(0, Math.max(PRODUCT_PICKS, chosen.length));
  }, [products.data, search, chosen]);
  return (
    <fieldset className="flex flex-col gap-[6px]">
      <legend className="mb-[4px] text-[13px]">Products ({chosen.length} chosen)</legend>
      <Input
        type="search"
        aria-label="Search products"
        placeholder="Search name or SKU"
        autoComplete="off"
        className={inputClass}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex flex-col">
        {matches.map((product) => (
          <CheckboxField
            key={product.id}
            label={`${product.name} · ${product.sku}`}
            checked={chosen.includes(product.id)}
            onCheckedChange={(on) => onChange(toggle(chosen, product.id, on === true))}
          />
        ))}
      </div>
    </fieldset>
  );
}
