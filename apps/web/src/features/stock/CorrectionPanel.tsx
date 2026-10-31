import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckboxField } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  describeApprovalError,
  useApprovalRequests,
  withdrawRequest,
} from '@/features/approvals/data';
import type { Product, Supplier } from '@/features/catalog/data';
import { selectClass } from '@/features/catalog/helpers';
import {
  correctStockIn,
  describeStockError,
  requestStockInCorrection,
  type StockReceipt,
} from './data';
import { COST, QTY } from './lines';

interface LineDraft {
  productId: string;
  qty: string;
  cost: string;
}

/**
 * INV-04 on a stock-in's page: the Owner corrects or deletes it; Special Sales asks the Owner
 * (for their own stock-ins, which are the only ones they see). The original is kept; the
 * correction is a new, linked stock-in.
 */
export function CorrectionPanel({
  receipt,
  products,
  suppliers,
  isOwner,
}: {
  receipt: StockReceipt;
  products: Map<string, Product>;
  suppliers: Supplier[];
  isOwner: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const requests = useApprovalRequests(20);
  const pending = isOwner
    ? undefined
    : requests.data.find(
        (request) =>
          request.type === 'stock_in_correction' &&
          request.targetId === receipt.id &&
          request.status === 'pending',
      );

  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState(receipt.supplierId ?? '');
  const [reference, setReference] = useState(receipt.reference ?? '');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = () => {
    setSupplierId(receipt.supplierId ?? '');
    setReference(receipt.reference ?? '');
    setLines(
      receipt.lines.map((line) => ({
        productId: line.productId,
        qty: String(line.qty),
        cost: line.unitCost.toFixed(2),
      })),
    );
    setDeleting(false);
    setReason('');
    setError(null);
    setNotice(null);
    setOpen(true);
    // The page's "Stock-in saved" line belongs to the save that brought us here; drop it so it
    // does not sit next to this panel's own message, or come back on a reload.
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  };

  // Suppliers that can be chosen: the active ones, plus the one already on it.
  const choices = suppliers
    .filter((supplier) => supplier.active || supplier.id === receipt.supplierId)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const nameOf = (id: string) => products.get(id)?.name ?? 'A product';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!deleting) {
      for (const line of lines) {
        if (!QTY.test(line.qty.trim()) || Number(line.qty) > 100_000) {
          setError(`${nameOf(line.productId)}: enter a whole quantity (0 takes it off).`);
          return;
        }
        if (!COST.test(line.cost.trim()) || Number(line.cost) < 0.01) {
          setError(`${nameOf(line.productId)}: enter the unit cost in pesos, at least ₱0.01.`);
          return;
        }
      }
    }
    if (!isOwner && !reason.trim()) {
      setError('Give a reason for the Owner.');
      return;
    }
    const correction = {
      supplierId: supplierId || null,
      reference,
      lines: lines.map((line) => ({
        product_id: line.productId,
        qty: Number(line.qty),
        unit_cost: Number(line.cost),
      })),
      delete: deleting,
      reason,
    };
    setBusy(true);
    try {
      if (isOwner) {
        const id = await correctStockIn(receipt.id, correction);
        navigate(`/stock-in/${id}`, { state: { corrected: true } });
      } else {
        await requestStockInCorrection(receipt.id, correction);
        setOpen(false);
        setNotice('Request sent. The Owner will decide; you can follow it in My requests.');
      }
    } catch (caught) {
      const { message } = (caught ?? {}) as { message?: unknown };
      setError(
        message === 'request_pending' || message === 'request_outdated'
          ? describeApprovalError(caught)
          : describeStockError(caught, nameOf),
      );
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <Card asChild size="panel" className="gap-[8px] py-[14px]">
        <section aria-label="Your correction request">
          <p className="text-[15px] font-semibold">
            Your{' '}
            {pending.after.delete === true
              ? 'request to delete this stock-in'
              : 'correction request'}{' '}
            is waiting for the Owner.
          </p>
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="flex flex-wrap items-center gap-[12px]">
            <Button
              needsInternet
              variant="secondary"
              size="md"
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
      </Card>
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
        <Button needsInternet variant="secondary" size="md" className="self-start" onClick={start}>
          {isOwner ? 'Correct this stock-in' : 'Request a correction'}
        </Button>
      </div>
    );
  }

  return (
    <Card asChild size="panel" className="gap-[12px] py-[16px]">
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        aria-label={isOwner ? 'Correct this stock-in' : 'Request a correction'}
      >
        <h2 className="text-[18px]">
          {isOwner ? 'Correct this stock-in' : 'Request a correction'}
        </h2>
        <p className="text-[13.5px] text-neutral-700">
          The stock-in stays as it was recorded; the correction is saved as a new, linked stock-in
          and the stock and cost follow it.
          {!isOwner && ' Nothing changes until the Owner approves.'}
        </p>
        <CheckboxField
          label="Delete this stock-in (every quantity on it comes back out of stock)"
          checked={deleting}
          onCheckedChange={(checked) => setDeleting(checked === true)}
        />
        {!deleting && (
          <>
            <div className="grid gap-[12px] sm:grid-cols-2">
              <div>
                <Label htmlFor="correct-supplier">Supplier</Label>
                <select
                  id="correct-supplier"
                  className={selectClass}
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                >
                  <option value="">No supplier</option>
                  {choices.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                      {supplier.active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="correct-reference">DR / invoice number</Label>
                <Input
                  id="correct-reference"
                  value={reference}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(event) => setReference(event.target.value)}
                  size="touch"
                  className="bg-bg"
                />
              </div>
            </div>
            <ol className="flex flex-col gap-[8px]">
              {lines.map((line, index) => {
                const name = nameOf(line.productId);
                return (
                  <Card
                    asChild
                    tone="inset"
                    key={line.productId}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_120px_150px] sm:items-end"
                  >
                    <li>
                      {/* As tall as the inputs, so the name lines up with them, not with their labels. */}
                      <span className="flex min-h-[48px] items-center text-[15px] font-semibold">
                        {name}
                      </span>
                      <div>
                        <Label htmlFor={`correct-qty-${index}`}>Qty</Label>
                        <Input
                          id={`correct-qty-${index}`}
                          aria-label={`Quantity of ${name}`}
                          inputMode="numeric"
                          value={line.qty}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row, i) =>
                                i === index ? { ...row, qty: event.target.value } : row,
                              ),
                            )
                          }
                          size="touch"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`correct-cost-${index}`}>Unit cost ₱</Label>
                        <Input
                          id={`correct-cost-${index}`}
                          aria-label={`Unit cost of ${name}`}
                          inputMode="decimal"
                          value={line.cost}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row, i) =>
                                i === index ? { ...row, cost: event.target.value } : row,
                              ),
                            )
                          }
                          size="touch"
                        />
                      </div>
                    </li>
                  </Card>
                );
              })}
            </ol>
            <p className="text-[12.5px] text-neutral-700">
              A quantity of 0 takes that product off this stock-in.
            </p>
          </>
        )}
        <div>
          <Label htmlFor="correct-reason">Reason{isOwner ? ' (optional)' : ''}</Label>
          <Input
            id="correct-reason"
            value={reason}
            maxLength={200}
            autoComplete="off"
            placeholder="For example: typed the wrong cost"
            onChange={(event) => setReason(event.target.value)}
            size="touch"
            className="bg-bg"
          />
        </div>
        {error && <Alert variant="danger">{error}</Alert>}
        <div className="flex flex-wrap gap-[10px]">
          <Button needsInternet type="submit" size="md" disabled={busy}>
            {busy
              ? 'Saving…'
              : isOwner
                ? deleting
                  ? 'Delete stock-in'
                  : 'Save correction'
                : 'Send request'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
