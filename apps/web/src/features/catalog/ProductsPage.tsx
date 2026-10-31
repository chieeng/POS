import { ChevronRight, Download, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tag } from '@/components/ui/tag';
import { formatPeso } from '@/lib/money';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { isLowStock } from '@/features/stock/data';
import { useCategories, useProducts } from './data';
import { exportProducts } from './export';
import { matchesSearch, selectClass } from './helpers';
import { ProductPhoto } from './ProductPhoto';

/**
 * Products (SRS 3.2): everyone in the branch sees them; the Owner and Special Sales add. The
 * Owner exports the whole list as CSV (PROD-06).
 */
export function ProductsPage() {
  const role = useSession((s) => s.user?.role);
  const canAdd = role === 'owner' || role === 'special_sales';
  const products = useProducts();
  const categories = useCategories();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await exportProducts(products.data, categories.data);
    } catch {
      setExportError('The export didn’t finish. Check your connection and try again.');
    } finally {
      setExporting(false);
    }
  };
  // The filters live in the URL (?q=&category=&inactive=1), so Back from a product restores
  // them, and a filtered list can be bookmarked. Replacing, not pushing, keeps Back simple.
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const categoryId = params.get('category') ?? '';
  const showInactive = params.get('inactive') === '1';
  const lowOnly = params.get('low') === '1';
  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const categoryName = useMemo(
    () => new Map(categories.data.map((category) => [category.id, category.name])),
    [categories.data],
  );
  const shown = products.data
    .filter((product) => showInactive || product.active)
    .filter((product) => !categoryId || product.categoryId === categoryId)
    .filter((product) => !lowOnly || isLowStock(product))
    .filter((product) => matchesSearch(product, search));

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={17}
            strokeWidth={ICON_STROKE}
            className="pointer-events-none absolute top-1/2 left-[14px] -translate-y-1/2 text-neutral-700"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search by name or SKU"
            placeholder="Search by name or SKU"
            value={search}
            onChange={(event) => setParam('q', event.target.value)}
            className="min-h-[46px] bg-surface pl-[40px] text-[15px]"
          />
        </div>
        {canAdd && (
          <Button asChild className="min-h-[46px] px-[18px]">
            <Link to="new">
              <Plus size={17} strokeWidth={ICON_STROKE} aria-hidden />
              Add product
            </Link>
          </Button>
        )}
        {role === 'owner' && (
          <Button
            variant="secondary"
            className="min-h-[46px] px-[18px]"
            disabled={exporting || products.loading || products.data.length === 0}
            onClick={() => void runExport()}
          >
            <Download size={17} strokeWidth={ICON_STROKE} aria-hidden />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        )}
      </div>
      {exportError && <Alert variant="danger">{exportError}</Alert>}
      <div className="flex flex-wrap items-center gap-[12px]">
        <select
          aria-label="Category"
          className={cn(selectClass, 'min-h-[40px] w-auto rounded-full bg-surface text-[14px]')}
          value={categoryId}
          onChange={(event) => setParam('category', event.target.value)}
        >
          <option value="">All categories</option>
          {[...categories.data]
            .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>
        <label className="flex items-center gap-[8px] text-[14px]">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setParam('inactive', event.target.checked ? '1' : '')}
            className="size-[18px] accent-accent"
          />
          Show inactive
        </label>
        <label className="flex items-center gap-[8px] text-[14px]">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(event) => setParam('low', event.target.checked ? '1' : '')}
            className="size-[18px] accent-accent"
          />
          Low stock only
        </label>
      </div>

      {products.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the products.</b> Check your connection and reload.
        </Alert>
      ) : products.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : products.data.length === 0 ? (
        <p className="text-neutral-700">
          No products yet.{canAdd ? ' Add the first one with “Add product”.' : ''}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-neutral-700">No products match.</p>
      ) : (
        <>
          <p className="px-[4px] text-[12.5px] text-neutral-700">
            {shown.length} {shown.length === 1 ? 'product' : 'products'}
          </p>
          <ul className="rounded-[30px] bg-surface px-[8px] py-[6px] md:px-[14px]">
            {shown.map((product) => (
              <li key={product.id} className="border-b border-text/8 last:border-b-0">
                <Link
                  to={product.id}
                  state={{ listSearch: location.search }}
                  className="flex min-h-[60px] items-center gap-[12px] rounded-[18px] px-[8px] py-[8px] text-text no-underline hover:bg-text/5"
                >
                  <ProductPhoto
                    productId={product.id}
                    photoKey={product.photoKey}
                    size={200}
                    className={cn('size-[44px] rounded-[12px]', !product.active && 'opacity-55')}
                  />
                  <span
                    className={cn('min-w-0 flex-1 leading-[1.3]', !product.active && 'opacity-55')}
                  >
                    <span className="block truncate text-[15px] font-semibold">{product.name}</span>
                    <span className="block truncate text-[12.5px] text-neutral-700">
                      {product.sku} · {categoryName.get(product.categoryId) ?? '—'}
                    </span>
                  </span>
                  {!product.active && <Tag variant="muted">Inactive</Tag>}
                  {isLowStock(product) && <Tag variant="accent">Low stock</Tag>}
                  <span className="text-right leading-[1.3]">
                    <span className="block text-[15px] font-semibold">
                      {formatPeso(product.sellPrice)}
                    </span>
                    <span className="block text-[12.5px] text-neutral-700">
                      / {product.unit} · {product.stockQty} in stock
                    </span>
                  </span>
                  <ChevronRight
                    size={17}
                    strokeWidth={ICON_STROKE}
                    className="flex-none text-neutral-700"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
