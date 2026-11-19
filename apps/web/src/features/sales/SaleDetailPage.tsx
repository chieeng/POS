import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetActions,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatPeso } from '@/lib/money';
import { formatQty, isSoldByMeasure } from '@/lib/quantity';
import { ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { fetchSaleDetail, METHOD_LABELS, type SaleDetail } from './history';
import { describeVoidError, requestSaleVoid, VOID_BLOCKED, voidAmounts, voidSale } from './void';

const when = (at: Date) =>
  at.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const signed = (amount: number) => `${amount < 0 ? '−' : '+'}${formatPeso(Math.abs(amount))}`;

/**
 * One sale from the history, as the new look's sale detail board shows it: each line, the
 * total, and how it was paid. Below it, "Something wrong with this sale?": a void (POS-10)
 * while the sale's drawer is still open, asked of the Owner with a reason, or done directly by
 * the Owner. Returns and corrections come in the next step 10 PRs.
 */
export function SaleDetailPage() {
  const { saleId = '' } = useParams();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; notFound: boolean } | { kind: 'ready'; sale: SaleDetail }
  >({ kind: 'loading' });
  const [reloads, setReloads] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSaleDetail(saleId).then(
      (sale) => !cancelled && setState({ kind: 'ready', sale }),
      (error: unknown) => {
        if (cancelled) return;
        const { message } = (error ?? {}) as { message?: unknown };
        setState({ kind: 'error', notFound: message === 'not_found' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [saleId, reloads]);

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-[14px] px-[16px] pt-[14px] pb-[24px] md:px-[26px] md:pt-[22px]">
      <div className="flex items-center gap-[10px]">
        <Link
          to="/sales"
          aria-label={isOwner ? 'Back to sales history' : 'Back to my sales'}
          className="grid size-11 flex-none place-items-center rounded-[12px] border border-divider bg-surface text-text"
        >
          <ArrowLeft size={20} strokeWidth={ICON_STROKE} aria-hidden />
        </Link>
        {state.kind === 'ready' && (
          <span className="flex min-w-0 flex-col leading-[1.2]">
            <h1 className="text-[18px] font-bold">Sale · {when(state.sale.madeAt)}</h1>
            <span className="text-[13px] break-all text-neutral-700">{state.sale.receiptNo}</span>
          </span>
        )}
      </div>

      {state.kind === 'loading' ? (
        <p role="status" className="text-neutral-700">
          Loading…
        </p>
      ) : state.kind === 'error' ? (
        <Alert variant="danger">
          {state.notFound
            ? 'This sale isn’t in your history. Staff see their own sales of the last 30 days.'
            : 'This sale needs internet. Connect and try again.'}
        </Alert>
      ) : (
        <>
          <Detail sale={state.sale} isOwner={isOwner} />
          {notice && (
            <p role="status" className="m-0 text-[14px] text-neutral-800">
              {notice}
            </p>
          )}
          <VoidSection
            sale={state.sale}
            isOwner={isOwner}
            onDone={(message) => {
              setNotice(message);
              setReloads((n) => n + 1);
            }}
          />
        </>
      )}
    </div>
  );
}

function Detail({ sale, isOwner }: { sale: SaleDetail; isOwner: boolean }) {
  const cash = sale.payments.find((payment) => payment.method === 'cash');
  return (
    <>
      <div className="flex flex-wrap items-center gap-[8px] text-[13.5px] text-neutral-700">
        {isOwner && <span>{sale.salesperson}</span>}
        {sale.status === 'voided' && <StatusBadge tone="danger">Voided</StatusBadge>}
        {sale.status === 'corrected' && <StatusBadge tone="pending">Corrected</StatusBadge>}
        {sale.madeOffline && <span>Made offline, reached the store {when(sale.syncedAt)}</span>}
      </div>

      <section
        aria-label="Items"
        className="flex flex-col rounded-[12px] bg-surface px-[16px] py-[12px] [font-variant-numeric:tabular-nums]"
      >
        {sale.lines.map((line) => (
          <div key={line.lineNo} className="flex flex-col py-[4px] text-[14px]">
            <div className="flex justify-between gap-[12px]">
              <span>
                {line.name} × {formatQty(line.qty)}
                {isSoldByMeasure(line.unit) ? ` ${line.unit}` : ''}
              </span>
              <span>{formatPeso(line.lineTotal)}</span>
            </div>
            {line.discount > 0 && (
              <span className="text-[12.5px] text-neutral-700">
                {line.discountName ?? 'Discount'} −{formatPeso(line.discount)}
              </span>
            )}
          </div>
        ))}
        {sale.discountTotal > 0 && (
          <Row label="Subtotal" value={formatPeso(sale.subtotal)} muted top />
        )}
        {sale.discountTotal > 0 && (
          <Row label="Discount" value={`−${formatPeso(sale.discountTotal)}`} muted />
        )}
        <Row label="Total" value={formatPeso(sale.total)} strong top={sale.discountTotal === 0} />
        {sale.vatRate !== null && sale.vatAmount !== null && (
          <Row label={`VAT ${sale.vatRate}% included`} value={formatPeso(sale.vatAmount)} muted />
        )}
        {sale.payments.map((payment, index) =>
          payment.method === 'cash' ? (
            <Row
              key={index}
              label={`Cash ${formatPeso(payment.amount + sale.change)} · change ${formatPeso(sale.change)}`}
              value={sale.rounding !== 0 ? `rounding ${signed(sale.rounding)}` : ''}
              muted
            />
          ) : (
            <Row
              key={index}
              label={`${METHOD_LABELS[payment.method]}${payment.accountLabel ? ` · ${payment.accountLabel}` : ''}${payment.reference ? ` · Ref ${payment.reference}` : ''}`}
              value={formatPeso(payment.amount)}
              muted
            />
          ),
        )}
        {!cash && sale.rounding !== 0 && (
          <Row label="Rounding" value={signed(sale.rounding)} muted />
        )}
      </section>
    </>
  );
}

/** POS-10: the void, as it stands for this sale. */
function VoidSection({
  sale,
  isOwner,
  onDone,
}: {
  sale: SaleDetail;
  isOwner: boolean;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (sale.status === 'voided') {
    return sale.void ? (
      <Alert variant="info">
        <span>
          <b>
            Voided {when(sale.void.at)} by {sale.void.by}.
          </b>{' '}
          Reason: {sale.void.reason}
          {sale.void.refundReference && ` · GCash/Maya refund ref ${sale.void.refundReference}`}
        </span>
      </Alert>
    ) : null;
  }
  if (sale.status !== 'completed') return null;
  if (sale.pendingVoid) {
    return (
      <Alert variant="info">
        <span>
          {sale.pendingVoid.mine ? (
            <>
              <b>You asked to void this sale.</b> Waiting for the Owner; you&apos;ll see the answer
              under <Link to="/requests">My requests</Link>.
            </>
          ) : (
            <>
              <b>{sale.salesperson} asked to void this sale:</b> {sale.pendingVoid.reason}. Decide
              in <Link to="/approvals">Approvals</Link>.
            </>
          )}
        </span>
      </Alert>
    );
  }

  const blocked = sale.voidable === 'ok' ? null : VOID_BLOCKED[sale.voidable];
  return (
    <section aria-labelledby="sale-wrong" className="flex flex-col gap-[10px]">
      <h2 id="sale-wrong" className="font-body text-[15px] font-bold">
        Something wrong with this sale?
      </h2>
      <Button
        variant="secondary"
        needsInternet
        disabled={blocked !== null}
        onClick={() => setOpen(true)}
        className="min-h-[60px] w-full justify-start gap-[12px] rounded-[12px] bg-surface px-[14px] text-left text-[15.5px] font-bold"
      >
        <span className="flex flex-1 flex-col gap-[2px]">
          <span>Void the sale</span>
          <span className="text-[12.5px] font-medium whitespace-normal text-neutral-700">
            {blocked ?? 'Its drawer is still open, so it can be voided'}
          </span>
        </span>
        <ChevronRight size={20} strokeWidth={ICON_STROKE} aria-hidden />
      </Button>
      <p className="m-0 text-[13px] leading-[1.45] text-neutral-700">
        {isOwner
          ? 'You void it straight away, with a reason; it is audit-logged.'
          : 'It goes to the Owner with your reason. Nothing changes until it is approved; you’ll see the answer under My requests.'}
      </p>
      <VoidSheet
        open={open}
        onOpenChange={setOpen}
        sale={sale}
        isOwner={isOwner}
        onDone={(message) => {
          setOpen(false);
          onDone(message);
        }}
      />
    </section>
  );
}

function VoidSheet({
  open,
  onOpenChange,
  sale,
  isOwner,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: SaleDetail;
  isOwner: boolean;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { cash, ewallet } = voidAmounts(sale);
  const ewalletName = sale.payments
    .filter((payment) => payment.method !== 'cash')
    .map((payment) => METHOD_LABELS[payment.method])
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(' and ');
  const items = sale.lines.reduce(
    (sum, line) => sum + (isSoldByMeasure(line.unit) ? 1 : line.qty),
    0,
  );

  const submit = async () => {
    setError(null);
    if (!reason.trim()) {
      setError('Say why the sale should be voided.');
      return;
    }
    if (isOwner && ewallet > 0 && !reference.trim()) {
      setError(`Type the reference of the ${ewalletName} refund you sent.`);
      return;
    }
    setBusy(true);
    try {
      if (isOwner) {
        await voidSale(sale.id, reason, ewallet > 0 ? reference : null);
        onDone('Sale voided. Its items are back in stock.');
      } else {
        await requestSaleVoid(sale.id, reason);
        onDone('Request sent. The Owner will decide; you can follow it in My requests.');
      }
      setReason('');
      setReference('');
    } catch (caught) {
      setError(describeVoidError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent>
        <SheetTitle>{isOwner ? 'Void this sale?' : 'Ask to void this sale?'}</SheetTitle>
        <SheetDescription>
          {isOwner
            ? 'The sale is voided now and its items go back to stock.'
            : 'If the Owner approves, the sale is voided and its items go back to stock.'}
        </SheetDescription>
        <div className="flex flex-col rounded-[12px] bg-surface px-[16px] py-[10px] [font-variant-numeric:tabular-nums]">
          <Row
            label={`Back to stock: ${formatQty(items)} ${items === 1 ? 'item' : 'items'}`}
            value=""
          />
          {cash > 0 && (
            <Row
              label="Cash back to the customer, from today’s drawer"
              value={formatPeso(cash)}
              strong
            />
          )}
          {ewallet > 0 && (
            <Row
              label={
                isOwner
                  ? `${ewalletName}: you send it back`
                  : `${ewalletName}: the Owner sends it back`
              }
              value={formatPeso(ewallet)}
              strong
            />
          )}
        </div>
        <div className="flex flex-col gap-[6px]">
          <Label htmlFor="void-reason" className="text-[13px]">
            Reason
          </Label>
          <Input
            id="void-reason"
            value={reason}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {isOwner && ewallet > 0 && (
          <div className="flex flex-col gap-[6px]">
            <Label htmlFor="void-reference" className="text-[13px]">
              {ewalletName} refund reference
            </Label>
            <Input
              id="void-reference"
              value={reference}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        <SheetActions>
          <SheetClose asChild>
            <Button variant="secondary" size="md" disabled={busy}>
              Cancel
            </Button>
          </SheetClose>
          <Button needsInternet size="md" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : isOwner ? 'Void the sale' : 'Send to the Owner'}
          </Button>
        </SheetActions>
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  value,
  strong = false,
  muted = false,
  top = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  top?: boolean;
}) {
  return (
    <div
      className={[
        'flex justify-between gap-[12px] py-[4px] text-[14px]',
        strong ? 'font-extrabold' : '',
        muted ? 'text-neutral-700' : '',
        top ? 'mt-[6px] border-t border-divider pt-[8px]' : '',
      ].join(' ')}
    >
      <span>{label}</span>
      <span className="whitespace-nowrap">{value}</span>
    </div>
  );
}
