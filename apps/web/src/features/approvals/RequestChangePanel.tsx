import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Category, Product } from '@/features/catalog/data';
import { toFields } from '@/features/catalog/helpers';
import { ProductForm } from '@/features/catalog/ProductForm';
import {
  currentValue,
  describeApprovalError,
  isOutdated,
  requestProductChange,
  useApprovalRequests,
  withdrawRequest,
} from './data';
import { RequestChanges } from './RequestChanges';

const REASON_MAX = 200;

/**
 * PROD-04: on a product's page, Special Sales asks the Owner for a change instead of making it.
 * With a pending request of theirs for this product, the page shows it and Withdraw instead.
 */
export function RequestChangePanel({
  product,
  categories,
}: {
  product: Product;
  categories: Category[];
}) {
  const requests = useApprovalRequests(20);
  const pending = requests.data.find(
    (request) => request.productId === product.id && request.status === 'pending',
  );

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [toggleActive, setToggleActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The request just sent. "Request sent…" shows only until it appears in the list (as pending,
  // or already decided): from then on the request itself, or its outcome, speaks for itself.
  const [sentId, setSentId] = useState<string | null>(null);
  const showSent = sentId !== null && !requests.data.some((request) => request.id === sentId);

  if (requests.loading) return null;

  const withdraw = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawRequest(pending.id);
      setNotice('Request withdrawn.');
    } catch (caught) {
      setError(describeApprovalError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    const outdated = isOutdated(pending, product);
    return (
      <section
        aria-label="Your request"
        className="flex flex-col gap-[10px] rounded-[30px] bg-surface px-[18px] py-[16px] md:px-[22px]"
      >
        <p className="text-[15px] font-semibold">Your request is waiting for the Owner.</p>
        {outdated && (
          <Alert variant="warn">
            <span>
              <b>Outdated:</b> the product changed since you asked. Withdraw this request and make a
              new one if the change is still needed.
            </span>
          </Alert>
        )}
        <RequestChanges
          request={pending}
          product={product}
          categories={categories}
          outdated={outdated}
        />
        <p className="text-[14px]">
          <span className="text-neutral-700">Your reason: </span>
          {pending.reason}
        </p>
        {error && <Alert variant="danger">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-[12px]">
          <Button
            variant="secondary"
            className="min-h-[44px] px-[18px]"
            disabled={busy}
            onClick={() => void withdraw()}
          >
            {busy ? 'Withdrawing…' : 'Withdraw'}
          </Button>
          <Link to="/requests" className="text-[14px]">
            All my requests
          </Link>
        </div>
      </section>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-[8px]">
        {(showSent || notice) && (
          <p role="status" className="px-[4px] text-[14px] text-neutral-800">
            {showSent
              ? 'Request sent. The Owner will decide; you can follow it in My requests.'
              : notice}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-[12px]">
          <Button
            className="min-h-[46px] px-[20px]"
            onClick={() => {
              setNotice(null);
              setError(null);
              setReason('');
              setToggleActive(false);
              setOpen(true);
            }}
          >
            Request a change
          </Button>
          <span className="text-[13px] text-neutral-700">The Owner approves or rejects it.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[10px]">
      <h2 className="px-[4px] text-[18px]">Request a change</h2>
      <p className="px-[4px] text-[13.5px] text-neutral-700">
        Change what should be different. Nothing changes until the Owner approves.
      </p>
      {error && <Alert variant="danger">{error}</Alert>}
      <ProductForm
        defaultValues={{
          sku: product.sku,
          name: product.name,
          categoryId: product.categoryId,
          unit: product.unit,
          sellPrice: String(product.sellPrice),
          reorderLevel: String(product.reorderLevel),
        }}
        categories={categories}
        currentCategoryId={product.categoryId}
        submitLabel="Send request"
        submittingLabel="Sending…"
        onEdit={() => setError(null)}
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          const fields: Record<string, unknown> = { ...toFields(values) };
          const changes = Object.fromEntries(
            Object.entries(fields).filter(([key, value]) => {
              const now = currentValue(product, key);
              return typeof value === 'number' ? Number(now) !== value : now !== value;
            }),
          );
          if (toggleActive) changes.active = !product.active;
          if (Object.keys(changes).length === 0) {
            setError('Change at least one thing, or close the form.');
            return;
          }
          if (!reason.trim()) {
            setError('Give a reason for the Owner.');
            return;
          }
          setBusy(true);
          try {
            const id = await requestProductChange(product.id, changes, reason.trim());
            setOpen(false);
            setNotice(null);
            setSentId(String(id));
          } catch (caught) {
            setError(describeApprovalError(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex items-center gap-[10px] text-[14.5px]">
          <input
            type="checkbox"
            checked={toggleActive}
            onChange={(event) => setToggleActive(event.target.checked)}
            className="size-[18px] accent-accent"
          />
          {product.active ? 'Deactivate this product' : 'Reactivate this product'}
        </label>
        <div>
          <Label htmlFor="request-reason" className="text-[13px]">
            Reason for the Owner
          </Label>
          <Input
            id="request-reason"
            value={reason}
            maxLength={REASON_MAX}
            autoComplete="off"
            placeholder="For example: the supplier raised the price"
            onChange={(event) => setReason(event.target.value)}
            className="min-h-[48px] bg-bg text-[15px]"
          />
        </div>
      </ProductForm>
    </div>
  );
}
