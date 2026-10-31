import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import {
  describeApprovalError,
  useApprovalRequests,
  withdrawRequest,
} from '@/features/approvals/data';
import type { Product } from '@/features/catalog/data';
import { selectClass } from '@/features/catalog/helpers';
import {
  ADJUSTMENT_LABELS,
  ADJUSTMENT_TYPES,
  adjustStock,
  describeStockError,
  requestStockAdjustment,
  type AdjustmentType,
} from './data';

type Direction = 'out' | 'in';

/**
 * INV-04 on a product's page: the Owner adjusts stock directly; Special Sales asks the Owner.
 * Damage, loss, expiry, found, store use (items taken for the store's or owner's own use) or
 * other, with a whole quantity and a reason. Stock never goes below zero.
 */
export function AdjustStockPanel({ product, isOwner }: { product: Product; isOwner: boolean }) {
  const requests = useApprovalRequests(20);
  const pending = isOwner
    ? undefined
    : requests.data.find(
        (request) =>
          request.type === 'stock_adjustment' &&
          request.productId === product.id &&
          request.status === 'pending',
      );

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AdjustmentType>('damage');
  const [direction, setDirection] = useState<Direction>('out');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setType('damage');
    setDirection('out');
    setQty('');
    setReason('');
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!/^\d{1,6}$/.test(qty.trim()) || Number(qty) < 1) {
      setError('Enter a whole quantity of at least 1.');
      return;
    }
    if (!reason.trim()) {
      setError('Give a reason.');
      return;
    }
    const signed = direction === 'out' ? -Number(qty) : Number(qty);
    setBusy(true);
    try {
      if (isOwner) {
        await adjustStock(product.id, type, signed, reason.trim());
        setNotice(`Stock adjusted: ${signed > 0 ? '+' : '−'}${Math.abs(signed)} ${product.unit}.`);
      } else {
        await requestStockAdjustment(product.id, type, signed, reason.trim());
        setNotice('Request sent. The Owner will decide; you can follow it in My requests.');
      }
      setOpen(false);
      reset();
    } catch (caught) {
      const { message } = (caught ?? {}) as { message?: unknown };
      setError(
        message === 'request_pending'
          ? describeApprovalError(caught)
          : describeStockError(caught, () => product.name),
      );
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    const signed = Number(pending.after.qty);
    return (
      <section
        aria-label="Your adjustment request"
        className="flex flex-col gap-[8px] rounded-[30px] bg-surface px-[18px] py-[14px] md:px-[22px]"
      >
        <p className="text-[15px]">
          <b>Your adjustment request is waiting for the Owner:</b>{' '}
          {ADJUSTMENT_LABELS[pending.after.type as AdjustmentType] ?? String(pending.after.type)}{' '}
          {signed > 0 ? '+' : '−'}
          {Math.abs(signed)} {product.unit}.
        </p>
        {error && <Alert variant="danger">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-[12px]">
          <Button
            variant="secondary"
            className="min-h-[44px] px-[18px]"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await withdrawRequest(pending.id);
              } catch (caught) {
                setError(describeApprovalError(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            Withdraw
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
      <div className="flex flex-col gap-[6px]">
        {notice && (
          <p role="status" className="px-[4px] text-[14px] text-neutral-800">
            {notice}
          </p>
        )}
        <Button
          variant="secondary"
          className="min-h-[46px] self-start px-[18px]"
          onClick={() => {
            setNotice(null);
            reset();
            setOpen(true);
          }}
        >
          {isOwner ? 'Adjust stock' : 'Request an adjustment'}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-label={isOwner ? 'Adjust stock' : 'Request an adjustment'}
      className="flex flex-col gap-[12px] rounded-[30px] bg-surface px-[18px] py-[16px] md:px-[22px]"
    >
      <h2 className="text-[18px]">{isOwner ? 'Adjust stock' : 'Request an adjustment'}</h2>
      <p className="text-[13.5px] text-neutral-700">
        Now {product.stockQty} {product.unit} in stock.
        {!isOwner && ' Nothing changes until the Owner approves.'}
      </p>
      <div className="grid gap-[12px] sm:grid-cols-2">
        <div>
          <Label htmlFor="adjust-type" className="text-[13px]">
            Why
          </Label>
          <select
            id="adjust-type"
            className={selectClass}
            value={type}
            onChange={(event) => {
              const next = event.target.value as AdjustmentType;
              setType(next);
              setDirection(next === 'found' ? 'in' : 'out');
            }}
          >
            {ADJUSTMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {ADJUSTMENT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="adjust-qty" className="text-[13px]">
            Quantity ({product.unit})
          </Label>
          <Input
            id="adjust-qty"
            inputMode="numeric"
            autoComplete="off"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            className="min-h-[48px] bg-bg text-[15px]"
          />
        </div>
      </div>
      <Segmented
        label="Direction"
        options={[
          { value: 'out', label: 'Take out of stock' },
          { value: 'in', label: 'Add to stock' },
        ]}
        value={direction}
        onChange={setDirection}
      />
      <div>
        <Label htmlFor="adjust-reason" className="text-[13px]">
          Reason
        </Label>
        <Input
          id="adjust-reason"
          value={reason}
          maxLength={200}
          autoComplete="off"
          placeholder="For example: crushed in delivery"
          onChange={(event) => setReason(event.target.value)}
          className="min-h-[48px] bg-bg text-[15px]"
        />
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="flex flex-wrap gap-[10px]">
        <Button type="submit" className="min-h-[46px] px-[20px]" disabled={busy}>
          {busy ? 'Saving…' : isOwner ? 'Save adjustment' : 'Send request'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[46px] px-[18px]"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
