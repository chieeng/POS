import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCategories, useProducts } from '@/features/catalog/data';
import { useUsers } from '@/features/users/data';
import { useSession } from '@/stores/session';
import {
  decideApproval,
  describeApprovalError,
  formatWhen,
  isOutdated,
  useApprovalRequests,
  type ApprovalRequest,
} from './data';
import { RequestChanges } from './RequestChanges';
import { StatusTag } from './StatusTag';

type Decision = { request: ApprovalRequest; approve: boolean } | null;

/**
 * Approvals (SRS 3.9, APPR-03, APPR-04), the Owner only: pending requests first, each with what
 * it changes, the reason and who asked; Approve applies it exactly as asked, Reject leaves the
 * product as it is. An outdated request (the product changed since) can only be rejected.
 */
export function ApprovalsPage() {
  const branchId = useSession((s) => s.user?.branchId ?? '');
  const requests = useApprovalRequests();
  const products = useProducts();
  const categories = useCategories();
  const users = useUsers(branchId);

  const [decision, setDecision] = useState<Decision>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const productById = useMemo(
    () => new Map(products.data.map((product) => [product.id, product])),
    [products.data],
  );
  const nameOf = (uid: string | null) =>
    (uid && users.data.find((user) => user.uid === uid)?.displayName) || 'Someone';

  const pending = requests.data.filter((request) => request.status === 'pending');
  const decided = requests.data.filter((request) => request.status !== 'pending');

  const open = (request: ApprovalRequest, approve: boolean) => {
    setNote('');
    setError(null);
    setNotice(null);
    setDecision({ request, approve });
  };

  const confirm = async () => {
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      await decideApproval(decision.request.id, decision.approve, note);
      const product = productById.get(decision.request.productId);
      setNotice(
        `${decision.approve ? 'Approved' : 'Rejected'}: ${product?.name ?? 'the request'}.`,
      );
      setDecision(null);
    } catch (caught) {
      setError(describeApprovalError(caught));
    } finally {
      setBusy(false);
    }
  };

  const loading = requests.loading || products.loading || categories.loading;

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <h1 className="text-[28px] md:text-[30px]">Approvals</h1>
      {notice && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          {notice}
        </p>
      )}

      {requests.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the requests.</b> Check your connection and reload.
        </Alert>
      ) : loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : (
        <>
          <h2 className="px-[4px] font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase">
            Waiting for you · {pending.length}
          </h2>
          {pending.length === 0 ? (
            <p className="px-[4px] text-neutral-700">Nothing is waiting for your approval.</p>
          ) : (
            <ul className="flex flex-col gap-[12px]">
              {pending.map((request) => {
                const product = productById.get(request.productId);
                const outdated = isOutdated(request, product);
                return (
                  <li
                    key={request.id}
                    className="flex flex-col gap-[10px] rounded-[30px] bg-surface px-[18px] py-[16px] md:px-[22px]"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-[10px]">
                      <Link
                        to={`/products/${request.productId}`}
                        className="text-[16px] font-semibold"
                      >
                        {product?.name ?? 'Product'}
                      </Link>
                      <span className="text-[13px] text-neutral-700">
                        {nameOf(request.requestedBy)} · {formatWhen(request.createdAt)}
                      </span>
                    </div>
                    {outdated && (
                      <Alert variant="warn">
                        <span>
                          <b>Outdated:</b> the product changed since this request. It can only be
                          rejected; {nameOf(request.requestedBy)} can make a new one.
                        </span>
                      </Alert>
                    )}
                    <RequestChanges
                      request={request}
                      product={product}
                      categories={categories.data}
                      outdated={outdated}
                    />
                    <p className="text-[14px]">
                      <span className="text-neutral-700">Reason: </span>
                      {request.reason}
                    </p>
                    <div className="flex flex-wrap gap-[10px]">
                      <Button
                        className="min-h-[44px] px-[20px]"
                        disabled={outdated}
                        onClick={() => open(request, true)}
                        aria-label={`Approve the request for ${product?.name ?? 'this product'}`}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        className="min-h-[44px] px-[18px]"
                        onClick={() => open(request, false)}
                        aria-label={`Reject the request for ${product?.name ?? 'this product'}`}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {decided.length > 0 && (
            <>
              <h2 className="mt-[8px] px-[4px] font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase">
                Decided
              </h2>
              <ul className="rounded-[30px] bg-surface px-[14px] py-[6px] md:px-[22px]">
                {decided.map((request) => {
                  const product = productById.get(request.productId);
                  return (
                    <li
                      key={request.id}
                      className="flex flex-col gap-[4px] border-b border-text/8 py-[10px] text-[14px] last:border-b-0"
                    >
                      <span className="flex flex-wrap items-center gap-[8px]">
                        <b>{product?.name ?? 'Product'}</b>
                        <StatusTag status={request.status} />
                      </span>
                      <span className="text-[12.5px] text-neutral-700">
                        {nameOf(request.requestedBy)} asked {formatWhen(request.createdAt)}
                        {request.decidedAt &&
                          ` · ${request.status === 'withdrawn' ? 'withdrawn' : `by ${nameOf(request.decidedBy)}`} ${formatWhen(request.decidedAt)}`}
                      </span>
                      {request.ownerNote && (
                        <span className="text-[13px]">Note: {request.ownerNote}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      <Dialog open={decision !== null} onOpenChange={(next) => !next && !busy && setDecision(null)}>
        {decision && (
          <DialogContent>
            <DialogTitle>
              {decision.approve ? 'Approve this change?' : 'Reject this request?'}
            </DialogTitle>
            <DialogDescription>
              {decision.approve
                ? 'The product changes exactly as requested, now.'
                : 'The product stays as it is.'}{' '}
              {nameOf(decision.request.requestedBy)} sees your decision and note.
            </DialogDescription>
            <div>
              <Label htmlFor="owner-note" className="text-[13px]">
                Note (optional)
              </Label>
              <Input
                id="owner-note"
                value={note}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => setNote(event.target.value)}
                className="min-h-[46px] bg-bg text-[15px]"
              />
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            <DialogActions>
              <DialogClose asChild>
                <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="min-h-[46px] px-[22px]"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy ? 'Saving…' : decision.approve ? 'Approve' : 'Reject'}
              </Button>
            </DialogActions>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
