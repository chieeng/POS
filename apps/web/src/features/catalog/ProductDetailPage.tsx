import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tag } from '@/components/ui/tag';
import { RequestChangePanel } from '@/features/approvals/RequestChangePanel';
import { PageHeader } from '@/features/settings/PageHeader';
import { isLowStock, useProductCost } from '@/features/stock/data';
import { AdjustStockPanel } from '@/features/stock/AdjustStockPanel';
import { StockHistory } from '@/features/stock/StockHistory';
import { formatPeso } from '@/lib/money';
import { useSession } from '@/stores/session';
import {
  describeCatalogError,
  updateProduct,
  useCategories,
  usePriceChanges,
  useProducts,
  type Product,
} from './data';
import { toFields } from './helpers';
import { PhotoPanel } from './PhotoPanel';
import { ProductForm } from './ProductForm';

const formatWhen = (when: Date) =>
  when.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const SOURCE_LABELS: Record<string, string> = {
  created: 'first price',
  owner_edit: '',
  approval: 'approved request',
  import: 'CSV import',
};

/**
 * Products > one product (SRS 3.2). Everyone sees the details and the photo. The Owner edits, changes the
 * price and deactivates (PROD-04); Special Sales requests a change for the Owner to approve
 * (SRS 3.9). The Owner and Special Sales see the price history (PROD-05).
 */
export function ProductDetailPage() {
  const { productId = '' } = useParams();
  const products = useProducts();
  const product = products.data.find((row) => row.id === productId);

  return (
    <div className="flex max-w-[640px] flex-col gap-[14px]">
      {products.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the product.</b> Check your connection and reload.
        </Alert>
      ) : products.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : !product ? (
        <>
          <PageHeader title="Product" backTo="/products" backLabel="Back to products" alwaysBack />
          <Alert variant="danger">This product was not found.</Alert>
        </>
      ) : (
        <ProductDetail product={product} />
      )}
    </div>
  );
}

function ProductDetail({ product }: { product: Product }) {
  const role = useSession((s) => s.user?.role);
  const isOwner = role === 'owner';
  const location = useLocation();
  const navigate = useNavigate();
  // Back to the list as the user left it: the list passes its filters (?q=&category=…) along.
  // Opened any other way (a link, the Approvals page), back goes to the plain list.
  const listSearch = (location.state as { listSearch?: string } | null)?.listSearch;
  const backTo = `/products${listSearch?.startsWith('?') ? listSearch : ''}`;
  const categories = useCategories();
  const category = categories.data.find((row) => row.id === product.categoryId);
  // INV-08: the Owner only; Row Level Security returns nothing to anyone else.
  const cost = useProductCost(product.id);
  const averageCost = isOwner ? cost.data[0] : undefined;

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    (location.state as { added?: boolean; photoFailed?: boolean } | null)?.added
      ? (location.state as { photoFailed?: boolean }).photoFailed
        ? 'Product added. The photo didn’t upload; add it again below.'
        : 'Product added.'
      : null,
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleActive = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateProduct(product.id, { active: !product.active });
      setNotice(product.active ? 'Product deactivated.' : 'Product reactivated.');
      setConfirming(false);
    } catch (caught) {
      setError(describeCatalogError(caught, 'product'));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string][] = [
    ['SKU', product.sku],
    ['Category', category ? `${category.name}${category.active ? '' : ' (inactive)'}` : '—'],
    ['Price', `${formatPeso(product.sellPrice)} / ${product.unit}`],
    ['In stock', `${product.stockQty} ${product.unit}${isLowStock(product) ? ' (low stock)' : ''}`],
    ...(averageCost === undefined
      ? []
      : ([['Average cost', `${formatPeso(averageCost)} / ${product.unit}`]] as [string, string][])),
    [
      'Reorder level',
      product.reorderLevel === 0 ? 'Off' : `${product.reorderLevel} ${product.unit}`,
    ],
  ];

  return (
    <>
      <PageHeader title={product.name} backTo={backTo} backLabel="Back to products" alwaysBack>
        {!product.active && <Tag variant="muted">Inactive</Tag>}
      </PageHeader>
      {notice && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          {notice}
        </p>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
      {!editing && <PhotoPanel product={product} role={role} onNotice={setNotice} />}

      {editing ? (
        <ProductForm
          defaultValues={{
            sku: product.sku,
            name: product.name,
            categoryId: product.categoryId,
            unit: product.unit,
            sellPrice: String(product.sellPrice),
            reorderLevel: String(product.reorderLevel),
          }}
          categories={categories.data}
          currentCategoryId={product.categoryId}
          submitLabel="Save changes"
          submittingLabel="Saving…"
          onSubmit={async (values) => {
            setError(null);
            try {
              await updateProduct(product.id, toFields(values));
              setEditing(false);
              setNotice('Saved.');
            } catch (caught) {
              setError(describeCatalogError(caught, 'product'));
            }
          }}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
          onEdit={() => setError(null)}
        />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-[10px] rounded-[30px] bg-surface px-[18px] py-[16px] text-[15px] md:px-[22px]">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-neutral-700">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {isOwner && !editing && (
        <div className="flex flex-wrap gap-[10px]">
          <Button
            className="min-h-[46px] px-[20px]"
            onClick={() => {
              setNotice(null);
              setEditing(true);
            }}
          >
            Edit product
          </Button>
          <Button
            variant="secondary"
            className="min-h-[46px] px-[18px]"
            onClick={() => {
              setNotice(null);
              setConfirming(true);
            }}
          >
            {product.active ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>
      )}
      {role === 'special_sales' && (
        <RequestChangePanel
          product={product}
          categories={categories.data}
          onStart={() => {
            setNotice(null);
            // "Product added." came in the router state: drop it there too, or a reload brings
            // it back next to the request.
            if ((location.state as { added?: boolean } | null)?.added) {
              navigate(location.pathname, { replace: true, state: null });
            }
          }}
        />
      )}
      {(isOwner || role === 'special_sales') && !editing && (
        <AdjustStockPanel product={product} isOwner={isOwner} />
      )}

      {(isOwner || role === 'special_sales') && <PriceHistory productId={product.id} />}
      {(isOwner || role === 'special_sales') && (
        <StockHistory productId={product.id} unit={product.unit} showCost={isOwner} />
      )}

      <Dialog open={confirming} onOpenChange={(open) => !open && !busy && setConfirming(false)}>
        <DialogContent>
          <DialogTitle>
            {product.active ? 'Deactivate' : 'Reactivate'} “{product.name}”?
          </DialogTitle>
          <DialogDescription>
            {product.active
              ? 'It disappears from selling and searches, but stays in sales history and reports. You can reactivate it later.'
              : 'It can be sold again.'}
          </DialogDescription>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="min-h-[46px] px-[22px]"
              disabled={busy}
              onClick={() => void toggleActive()}
            >
              {busy ? 'Saving…' : product.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PriceHistory({ productId }: { productId: string }) {
  const history = usePriceChanges(productId);
  return (
    <section className="flex flex-col gap-[6px]" aria-labelledby="price-history">
      <h2
        id="price-history"
        className="px-[4px] font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase"
      >
        Price history
      </h2>
      {history.error ? (
        <Alert variant="danger">Couldn&apos;t load the price history.</Alert>
      ) : history.loading ? (
        <p className="px-[4px] text-neutral-700" role="status">
          Loading…
        </p>
      ) : (
        <ul className="rounded-[30px] bg-surface px-[14px] py-[6px] md:px-[22px]">
          {history.data.map((change) => {
            const note = SOURCE_LABELS[change.source];
            return (
              <li
                key={change.id}
                className="flex flex-wrap items-baseline gap-x-[10px] border-b border-text/8 py-[10px] text-[14px] last:border-b-0"
              >
                <span className="text-neutral-700">{formatWhen(change.createdAt)}</span>
                <span className="font-semibold">
                  {change.oldPrice === null
                    ? formatPeso(change.newPrice)
                    : `${formatPeso(change.oldPrice)} → ${formatPeso(change.newPrice)}`}
                </span>
                <span className="text-neutral-700">
                  · {change.changedByName}
                  {note ? ` · ${note}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
