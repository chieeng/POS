import { Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createProduct,
  describeCatalogError,
  useCategories,
  useProducts,
  useSuppliers,
  type Product,
} from '@/features/catalog/data';
import { matchesSearch, selectClass, toFields } from '@/features/catalog/helpers';
import { ProductForm } from '@/features/catalog/ProductForm';
import { PageHeader } from '@/features/settings/PageHeader';
import { formatPeso } from '@/lib/money';
import { ICON_STROKE } from '@/lib/utils';
import { describeStockError, recordStockIn } from './data';
import { COST, lineProblem, MAX_LINES, OPENING_STOCK, QTY, type Line } from './lines';

/**
 * New stock-in (INV-02, INV-03), the Owner and Special Sales: a delivery from a supplier, or
 * the opening stock. Lines are found by name or SKU, or added as new products on the spot. Each
 * product once; active products and suppliers only; every line needs its unit cost.
 */
export function NewStockInPage() {
  const navigate = useNavigate();
  const products = useProducts();
  const suppliers = useSuppliers();
  const categories = useCategories();

  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const activeSuppliers = suppliers.data
    .filter((supplier) => supplier.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  // Inactive products are never stocked in; say so, so nobody adds the same product again.
  const inactiveMatches = useMemo(
    () =>
      search.trim()
        ? products.data
            .filter((product) => !product.active && matchesSearch(product, search))
            .slice(0, 3)
        : [],
    [products.data, search],
  );

  const matches = useMemo(
    () =>
      search.trim()
        ? products.data
            .filter((product) => product.active && matchesSearch(product, search))
            .slice(0, 8)
        : [],
    [products.data, search],
  );

  const addLine = (product: Pick<Product, 'id' | 'name' | 'sku' | 'unit'>) => {
    setError(null);
    const at = lines.findIndex((line) => line.productId === product.id);
    if (at >= 0) {
      setMessage(`${product.name} is already on line ${at + 1}.`);
      return;
    }
    if (lines.length >= MAX_LINES) {
      setMessage(`A stock-in can have up to ${MAX_LINES} lines. Save this one and start another.`);
      return;
    }
    setMessage(null);
    setLines((current) => [
      ...current,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        qty: '',
        cost: '',
      },
    ]);
    setSearch('');
  };

  const update = (index: number, change: Partial<Line>) => {
    setError(null);
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...change } : line)));
  };

  const total = lines.reduce((sum, line) => {
    const qty = Number(line.qty);
    const cost = Number(line.cost);
    return Number.isFinite(qty) && Number.isFinite(cost) ? sum + qty * cost : sum;
  }, 0);

  const save = async () => {
    setError(null);
    setMessage(null);
    if (lines.length === 0) {
      setError('Add at least one product.');
      return;
    }
    const problem = lines.map(lineProblem).find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      const id = await recordStockIn(
        supplierId || null,
        reference,
        lines.map((line) => ({
          product_id: line.productId,
          qty: Number(line.qty),
          unit_cost: Number(line.cost),
        })),
      );
      navigate(`/stock-in/${id}`, { state: { saved: true } });
    } catch (caught) {
      setError(
        describeStockError(
          caught,
          (id) => lines.find((line) => line.productId === id)?.name ?? 'A product',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex w-full max-w-[860px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <PageHeader
        title="New stock-in"
        backTo="/stock-in"
        backLabel="Back to stock-ins"
        alwaysBack
      />

      <section className="grid gap-[14px] rounded-[30px] bg-surface px-[18px] py-[16px] sm:grid-cols-2 md:px-[22px]">
        <div>
          <Label htmlFor="stock-supplier" className="text-[13px]">
            Supplier (optional)
          </Label>
          <select
            id="stock-supplier"
            className={selectClass}
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">No supplier</option>
            {activeSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="stock-reference" className="text-[13px]">
            DR / invoice number (optional)
          </Label>
          <Input
            id="stock-reference"
            value={reference}
            maxLength={60}
            autoComplete="off"
            onChange={(event) => setReference(event.target.value)}
            className="min-h-[48px] bg-bg text-[15px]"
          />
          <button
            type="button"
            className="mt-[6px] text-[13px] text-accent-700 underline"
            onClick={() => {
              setReference(OPENING_STOCK);
              setSupplierId('');
            }}
          >
            This is the opening stock (what is on the shelves today)
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-[10px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={17}
              strokeWidth={ICON_STROKE}
              className="pointer-events-none absolute top-1/2 left-[14px] -translate-y-1/2 text-neutral-700"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Find a product by name or SKU"
              placeholder="Find a product by name or SKU"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-h-[46px] bg-surface pl-[40px] text-[15px]"
            />
          </div>
          <Button
            variant="secondary"
            className="min-h-[46px] px-[16px]"
            onClick={() => {
              setProductError(null);
              setAddingProduct(true);
            }}
          >
            <Plus size={17} strokeWidth={ICON_STROKE} aria-hidden />
            New product
          </Button>
        </div>
        {search.trim() && (
          <ul aria-label="Matching products" className="rounded-[22px] bg-surface p-[6px]">
            {inactiveMatches.map((product) => (
              <li key={product.id} className="px-[10px] py-[8px] text-[14px] text-warn-fg">
                {product.name} ({product.sku}) is inactive. Ask the Owner to reactivate it.
              </li>
            ))}
            {matches.length === 0 && inactiveMatches.length === 0 ? (
              <li className="px-[10px] py-[8px] text-[14px] text-neutral-700">
                No product matches. Add it with “New product”.
              </li>
            ) : (
              matches.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => addLine(product)}
                    className="flex w-full items-center gap-[10px] rounded-[16px] px-[10px] py-[8px] text-left text-[14.5px] hover:bg-text/5"
                  >
                    <span className="flex-1">
                      <b>{product.name}</b>{' '}
                      <span className="text-neutral-700">
                        · {product.sku} · {product.stockQty} {product.unit} in stock
                      </span>
                    </span>
                    <Plus size={16} strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
        {message && (
          <p role="status" className="px-[4px] text-[14px] font-semibold text-warn-fg">
            {message}
          </p>
        )}
      </section>

      {lines.length > 0 && (
        <ol className="flex flex-col gap-[8px]">
          {lines.map((line, index) => (
            <li
              key={line.productId}
              aria-label={`Line ${index + 1}: ${line.name}`}
              className="grid grid-cols-[28px_1fr_auto] items-center gap-x-[10px] gap-y-[8px] rounded-[22px] bg-surface px-[14px] py-[10px] md:grid-cols-[28px_1fr_110px_140px_110px_auto]"
            >
              <span className="text-[13px] text-neutral-700">{index + 1}</span>
              <span className="min-w-0 leading-[1.25]">
                <span className="block truncate text-[15px] font-semibold">{line.name}</span>
                <span className="block text-[12.5px] text-neutral-700">
                  {line.sku} · per {line.unit}
                </span>
              </span>
              <Button
                variant="secondary"
                size="icon"
                className="md:order-last"
                aria-label={`Remove ${line.name}`}
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} strokeWidth={ICON_STROKE} aria-hidden />
              </Button>
              <label className="col-start-2 flex flex-col gap-[2px] text-[12px] text-neutral-700 md:col-start-auto">
                Qty
                <Input
                  aria-label={`Quantity of ${line.name}`}
                  placeholder="Qty"
                  inputMode="numeric"
                  value={line.qty}
                  onChange={(event) => update(index, { qty: event.target.value })}
                  className="min-h-[44px] bg-bg text-[15px] text-text"
                />
              </label>
              <label className="col-start-2 flex flex-col gap-[2px] text-[12px] text-neutral-700 md:col-start-auto">
                Unit cost ₱
                <Input
                  aria-label={`Unit cost of ${line.name}`}
                  placeholder="Unit cost ₱"
                  inputMode="decimal"
                  value={line.cost}
                  onChange={(event) => update(index, { cost: event.target.value })}
                  className="min-h-[44px] bg-bg text-[15px] text-text"
                />
              </label>
              <span className="col-start-2 text-right text-[14px] font-semibold md:col-start-auto">
                {QTY.test(line.qty) && COST.test(line.cost)
                  ? formatPeso(Number(line.qty) * Number(line.cost))
                  : '—'}
              </span>
            </li>
          ))}
        </ol>
      )}

      {error && <Alert variant="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-[14px]">
        <Button className="min-h-[48px] px-[24px]" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save stock-in'}
        </Button>
        <span className="text-[15px]">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'} · total <b>{formatPeso(total)}</b>
        </span>
      </div>
      <p className="px-[4px] text-[12.5px] text-neutral-700">
        Saving adds the quantities to stock at once. A mistake is fixed with a correction later.
      </p>

      <Dialog open={addingProduct} onOpenChange={(open) => !open && setAddingProduct(false)}>
        <DialogContent className="w-[min(560px,calc(100vw-32px))]">
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>It is added to the products and to this stock-in.</DialogDescription>
          {productError && <Alert variant="danger">{productError}</Alert>}
          <ProductForm
            defaultValues={{
              sku: '',
              name: '',
              categoryId: '',
              unit: 'pc',
              sellPrice: '',
              reorderLevel: '0',
            }}
            categories={categories.data}
            submitLabel="Add product"
            submittingLabel="Adding…"
            onEdit={() => setProductError(null)}
            onCancel={() => setAddingProduct(false)}
            onSubmit={async (values) => {
              try {
                const fields = toFields(values);
                const id = await createProduct(fields);
                setAddingProduct(false);
                addLine({
                  id,
                  name: fields.name.trim(),
                  sku: fields.sku.trim().toUpperCase(),
                  unit: fields.unit,
                });
              } catch (caught) {
                setProductError(describeCatalogError(caught, 'product'));
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
