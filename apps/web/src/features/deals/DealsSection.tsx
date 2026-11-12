import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Tag } from '@/components/ui/tag';
import { useProducts, type Product } from '@/features/catalog/data';
import { matchesSearch } from '@/features/catalog/helpers';
import { isSoldByMeasure } from '@/lib/quantity';
import { ICON_STROKE } from '@/lib/utils';
import {
  createDeal,
  describeDealError,
  sortDeals,
  updateDeal,
  useDeals,
  type DealFields,
} from './data';
import { dealSummary, type DealKind, type DealRule } from './rules';

const sectionClass =
  'flex flex-col gap-[14px] rounded-[30px] bg-surface px-[18px] py-[18px] md:px-[22px]';
const headingClass = 'font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase';
const inputClass = 'min-h-[48px] bg-bg text-[15px]';

const KINDS = [
  { value: 'quantity', label: 'N for ₱' },
  { value: 'bundle', label: 'Bundle' },
] as const;

// Products listed at a time while choosing; the search narrows them.
const PRODUCT_PICKS = 30;

/**
 * POS-03 and SYS-01 in Store settings: the Owner's package deals. "3 for ₱100" over any mix of
 * chosen products, or a bundle of specific items at one price; whole units only (the owner's
 * decisions of Nov 12, 2026). Staff apply a deal the cart offers. A deal is switched off, never
 * deleted. No design exists for this section: it follows the preset discounts.
 */
export function DealsSection() {
  const deals = useDeals();
  const products = useProducts();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = sortDeals(deals.data);
  const nameOf = (id: string) => products.data.find((product) => product.id === id)?.name;

  const setActive = async (deal: DealRule, active: boolean) => {
    setError(null);
    setBusyId(deal.id);
    try {
      await updateDeal(deal.id, { active });
    } catch (caught) {
      setError(describeDealError(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={sectionClass} aria-labelledby="deals-heading">
      <h2 id="deals-heading" className={headingClass}>
        Package deals
      </h2>
      <p className="text-[13.5px] text-neutral-700">
        The cart offers a deal when it holds a full set; staff tap Apply. It repeats for every full
        set, and leftover units keep the regular price. Whole units only: products sold by kg or L
        can take a preset discount instead.
      </p>
      {error && <Alert variant="danger">{error}</Alert>}

      {deals.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the deals.</b> Check your connection and reload.
        </Alert>
      ) : deals.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : list.length === 0 ? (
        !adding && <p className="text-[14px] text-neutral-700">No deals yet.</p>
      ) : (
        <ul aria-label="Package deals" className="flex flex-col">
          {list.map((deal) => (
            <li
              key={deal.id}
              aria-label={deal.name}
              className="flex flex-col gap-[10px] border-b border-text/8 py-[10px] last:border-b-0"
            >
              {editingId === deal.id ? (
                <DealForm
                  deal={deal}
                  products={products.data}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-[10px]">
                  <span
                    className={deal.active ? 'min-w-0 flex-1' : 'min-w-0 flex-1 text-neutral-700'}
                  >
                    <b className="block text-[15px]">{deal.name}</b>
                    <span className="block text-[13.5px]">
                      {dealSummary(deal, nameOf)}
                      {deal.kind === 'quantity' &&
                        ` · ${deal.productIds.length} ${deal.productIds.length === 1 ? 'product' : 'products'}`}
                    </span>
                  </span>
                  {!deal.active && <Tag variant="muted">Off</Tag>}
                  <Button
                    needsInternet
                    variant="secondary"
                    className="min-h-[44px] px-[14px]"
                    aria-label={`Edit ${deal.name}`}
                    onClick={() => {
                      setError(null);
                      setAdding(false);
                      setEditingId(deal.id);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    needsInternet
                    variant="secondary"
                    className="min-h-[44px] px-[14px]"
                    aria-label={`${deal.active ? 'Switch off' : 'Switch on'} ${deal.name}`}
                    disabled={busyId === deal.id}
                    onClick={() => void setActive(deal, !deal.active)}
                  >
                    {deal.active ? 'Switch off' : 'Switch on'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <DealForm
          products={products.data}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
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
          Add deal
        </Button>
      )}
    </section>
  );
}

const PRICE = /^\d{1,7}(\.\d{1,2})?$/;

/** Add a deal, or change one (its kind stays). */
function DealForm({
  deal,
  products,
  onDone,
  onCancel,
}: {
  deal?: DealRule;
  products: Product[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const prefix = deal ? `deal-${deal.id}` : 'deal-new';
  const [name, setName] = useState(deal?.name ?? '');
  const [kind, setKind] = useState<DealKind>(deal?.kind ?? 'quantity');
  const [price, setPrice] = useState(deal ? String(deal.price) : '');
  const [setSize, setSetSize] = useState(deal?.setSize ? String(deal.setSize) : '3');
  const [productIds, setProductIds] = useState<string[]>(
    deal?.kind === 'quantity' ? deal.productIds : [],
  );
  const [items, setItems] = useState<{ productId: string; qty: string }[]>(
    deal?.kind === 'bundle'
      ? deal.productIds.map((productId, i) => ({ productId, qty: String(deal.qtys[i] ?? 1) }))
      : [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the deal a name staff will recognise.';
    const amount = PRICE.test(price.trim()) ? Number(price.trim()) : 0;
    if (amount <= 0) next.price = 'Enter the price of one set, for example 100 or 19.50.';
    const size = Number(setSize);
    if (kind === 'quantity') {
      if (!Number.isInteger(size) || size < 2 || size > 100)
        next.setSize = 'A set is 2 to 100 units.';
      if (productIds.length === 0) next.products = 'Choose at least one product.';
    } else {
      if (items.length < 2) next.products = 'A bundle has at least two different items.';
      if (items.some((item) => !/^\d{1,3}$/.test(item.qty) || +item.qty < 1 || +item.qty > 100))
        next.products = 'Each item counts 1 to 100.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const fields: DealFields = {
      name: name.trim(),
      kind,
      price: amount,
      set_size: kind === 'quantity' ? size : null,
      product_ids: kind === 'quantity' ? productIds : items.map((item) => item.productId),
      qtys: kind === 'bundle' ? items.map((item) => Number(item.qty)) : [],
    };
    setSaving(true);
    setError(null);
    try {
      if (deal) {
        const { kind: _kind, ...changes } = fields;
        void _kind;
        await updateDeal(deal.id, changes);
      } else {
        await createDeal(fields);
      }
      onDone();
    } catch (caught) {
      setError(describeDealError(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label={deal ? `Edit ${deal.name}` : 'Add a deal'}
      className="flex flex-col gap-[12px] rounded-[22px] bg-bg px-[14px] py-[14px]"
    >
      {error && <Alert variant="danger">{error}</Alert>}
      <Field
        id={`${prefix}-name`}
        label="Name"
        error={errors.name}
        input={
          <Input
            id={`${prefix}-name`}
            autoComplete="off"
            maxLength={40}
            placeholder="For example: Chips 3 for ₱100"
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={!!errors.name || undefined}
          />
        }
      />
      {deal ? (
        <p className="text-[13.5px] text-neutral-700">
          {deal.kind === 'quantity' ? 'An "N for ₱" deal.' : 'A bundle.'} To change its kind, switch
          it off and add a new deal.
        </p>
      ) : (
        <Segmented
          label="Kind"
          options={KINDS}
          value={kind}
          onChange={(next) => setKind(next as DealKind)}
        />
      )}
      <div className="grid gap-[12px] sm:grid-cols-2">
        {kind === 'quantity' && (
          <Field
            id={`${prefix}-size`}
            label="Units in a set"
            error={errors.setSize}
            input={
              <Input
                id={`${prefix}-size`}
                inputMode="numeric"
                autoComplete="off"
                className={inputClass}
                value={setSize}
                onChange={(event) => setSetSize(event.target.value)}
                aria-invalid={!!errors.setSize || undefined}
              />
            }
          />
        )}
        <Field
          id={`${prefix}-price`}
          label="Price of one set"
          error={errors.price}
          input={
            <Input
              id={`${prefix}-price`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="100.00"
              className={inputClass}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              aria-invalid={!!errors.price || undefined}
            />
          }
        />
      </div>
      {kind === 'quantity' ? (
        <ProductPicker
          products={products}
          legend={`Products that count toward a set (${productIds.length} chosen)`}
          chosen={productIds}
          onToggle={(id, on) =>
            setProductIds((list) =>
              on ? [...new Set([...list, id])] : list.filter((x) => x !== id),
            )
          }
        />
      ) : (
        <BundleItems products={products} items={items} onChange={setItems} />
      )}
      {errors.products && <p className="text-[13px] text-danger-fg">{errors.products}</p>}
      <div className="flex flex-wrap gap-[10px]">
        <Button needsInternet type="submit" className="min-h-[46px] px-[20px]" disabled={saving}>
          {saving ? 'Saving…' : deal ? 'Save deal' : 'Add deal'}
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

function Field({
  id,
  label,
  error,
  input,
}: {
  id: string;
  label: string;
  error?: string;
  input: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {input}
      {error && <p className="mt-[5px] text-[13px] text-danger-fg">{error}</p>}
    </div>
  );
}

/** Whole-unit products only (the owner's decision of Nov 12): kg and L never join a deal. */
function useDealProducts(products: Product[], search: string, chosen: string[]) {
  return useMemo(() => {
    const picked = (product: Product) => chosen.includes(product.id);
    return products
      .filter(
        (product) =>
          picked(product) ||
          (product.active && !isSoldByMeasure(product.unit) && matchesSearch(product, search)),
      )
      .sort((a, b) => Number(picked(b)) - Number(picked(a)))
      .slice(0, Math.max(PRODUCT_PICKS, chosen.length));
  }, [products, search, chosen]);
}

function ProductPicker({
  products,
  legend,
  chosen,
  onToggle,
}: {
  products: Product[];
  legend: string;
  chosen: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const matches = useDealProducts(products, search, chosen);
  return (
    <fieldset className="flex flex-col gap-[6px]">
      <legend className="mb-[4px] text-[13px]">{legend}</legend>
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
            onCheckedChange={(on) => onToggle(product.id, on === true)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function BundleItems({
  products,
  items,
  onChange,
}: {
  products: Product[];
  items: { productId: string; qty: string }[];
  onChange: (items: { productId: string; qty: string }[]) => void;
}) {
  const nameOf = (id: string) => products.find((product) => product.id === id)?.name ?? 'Item';
  return (
    <div className="flex flex-col gap-[10px]">
      {items.length > 0 && (
        <ul aria-label="Bundle items" className="flex flex-col gap-[6px]">
          {items.map((item) => (
            <li key={item.productId} className="flex items-center gap-[10px]">
              <Input
                aria-label={`How many ${nameOf(item.productId)}`}
                inputMode="numeric"
                className="min-h-[44px] w-[72px] bg-surface text-center text-[15px]"
                value={item.qty}
                onChange={(event) =>
                  onChange(
                    items.map((each) =>
                      each.productId === item.productId
                        ? { ...each, qty: event.target.value }
                        : each,
                    ),
                  )
                }
              />
              <span className="min-w-0 flex-1 text-[14.5px]">{nameOf(item.productId)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Take ${nameOf(item.productId)} out of the bundle`}
                onClick={() => onChange(items.filter((each) => each.productId !== item.productId))}
              >
                <Trash2 size={17} strokeWidth={ICON_STROKE} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ProductPicker
        products={products}
        legend={`Items in the bundle (${items.length} chosen)`}
        chosen={items.map((item) => item.productId)}
        onToggle={(id, on) =>
          onChange(
            on
              ? items.some((item) => item.productId === id)
                ? items
                : [...items, { productId: id, qty: '1' }]
              : items.filter((item) => item.productId !== id),
          )
        }
      />
    </div>
  );
}
