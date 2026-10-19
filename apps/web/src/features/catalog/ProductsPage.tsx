import { ChevronRight, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tag } from '@/components/ui/tag';
import { formatPeso } from '@/lib/money';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { useCategories, useProducts } from './data';
import { matchesSearch, selectClass } from './helpers';

/** Products (SRS 3.2): everyone in the branch sees them; the Owner and Special Sales add. */
export function ProductsPage() {
  const role = useSession((s) => s.user?.role);
  const canAdd = role === 'owner' || role === 'special_sales';
  const products = useProducts();
  const categories = useCategories();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const categoryName = useMemo(
    () => new Map(categories.data.map((category) => [category.id, category.name])),
    [categories.data],
  );
  const shown = products.data
    .filter((product) => showInactive || product.active)
    .filter((product) => !categoryId || product.categoryId === categoryId)
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
            onChange={(event) => setSearch(event.target.value)}
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
      </div>
      <div className="flex flex-wrap items-center gap-[12px]">
        <select
          aria-label="Category"
          className={cn(selectClass, 'min-h-[40px] w-auto rounded-full bg-surface text-[14px]')}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
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
            onChange={(event) => setShowInactive(event.target.checked)}
            className="size-[18px] accent-accent"
          />
          Show inactive
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
                  className="flex min-h-[60px] items-center gap-[12px] rounded-[18px] px-[8px] py-[8px] text-text no-underline hover:bg-text/5"
                >
                  <span
                    className={cn('min-w-0 flex-1 leading-[1.3]', !product.active && 'opacity-55')}
                  >
                    <span className="block truncate text-[15px] font-semibold">{product.name}</span>
                    <span className="block truncate text-[12.5px] text-neutral-700">
                      {product.sku} · {categoryName.get(product.categoryId) ?? '—'}
                    </span>
                  </span>
                  {!product.active && <Tag variant="muted">Inactive</Tag>}
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
