import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckboxField } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
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
import { fetchSaleDetail, METHOD_LABELS, type PayMethod, type SaleDetail } from './history';
import {
  describeReturnError,
  leftOf,
  planRefund,
  refundableBy,
  requestSaleReturn,
  returnSale,
  type ReturnCondition,
  type ReturnPick,
} from './returns';
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
 * total, and how it was paid. Below it, "Something wrong with this sale?" (POS-10): a void
 * while the sale's drawer is still open, and a return of some or all items within the return
 * window, each asked of the Owner with a reason, or done directly by the Owner. Corrections
 * come after go-live.
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
          <FixSection
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

/** POS-10: voids and returns, as they stand for this sale. */
function FixSection({
  sale,
  isOwner,
  onDone,
}: {
  sale: SaleDetail;
  isOwner: boolean;
  onDone: (message: string) => void;
}) {
  const [sheet, setSheet] = useState<'void' | 'return' | null>(null);

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

  const done = (message: string) => {
    setSheet(null);
    onDone(message);
  };
  const voidBlocked = sale.voidable === 'ok' ? null : VOID_BLOCKED[sale.voidable];
  const anyLeft =
    sale.lines.some((line) => leftOf(line) > 0) &&
    refundableBy(sale).some((method) => method.left > 0);
  const showVoid = !sale.pendingVoid && sale.voidable !== 'sale_has_returns';
  const showReturn = !sale.pendingReturn && anyLeft;
  const anyEnabled = (showVoid && voidBlocked === null) || showReturn;
  const { days, late } = sale.returnWindow;

  return (
    <>
      <ReturnsMade sale={sale} />
      {sale.pendingVoid && (
        <Alert variant="info">
          <span>
            {sale.pendingVoid.mine ? (
              <>
                <b>You asked to void this sale.</b> Waiting for the Owner; you&apos;ll see the
                answer under <Link to="/requests">My requests</Link>.
              </>
            ) : (
              <>
                <b>{sale.salesperson} asked to void this sale:</b> {sale.pendingVoid.reason}. Decide
                in <Link to="/approvals">Approvals</Link>.
              </>
            )}
          </span>
        </Alert>
      )}
      {sale.pendingReturn && (
        <Alert variant="info">
          <span>
            {sale.pendingReturn.mine ? (
              <>
                <b>You asked for a return</b> ({formatPeso(sale.pendingReturn.refund)}{' '}
                {METHOD_LABELS[sale.pendingReturn.method]}). Waiting for the Owner; you&apos;ll see
                the answer under <Link to="/requests">My requests</Link>.
              </>
            ) : (
              <>
                <b>{sale.salesperson} asked for a return:</b> {sale.pendingReturn.reason}. Decide in{' '}
                <Link to="/approvals">Approvals</Link>.
              </>
            )}
          </span>
        </Alert>
      )}
      {(showVoid || showReturn) && (
        <section aria-labelledby="sale-wrong" className="flex flex-col gap-[10px]">
          <h2 id="sale-wrong" className="font-body text-[15px] font-bold">
            Something wrong with this sale?
          </h2>
          {showVoid && (
            <ActionRow
              label="Void the sale"
              hint={voidBlocked ?? 'Its drawer is still open, so it can be voided'}
              disabled={voidBlocked !== null}
              onClick={() => setSheet('void')}
            />
          )}
          {showReturn && (
            <ActionRow
              label="Return items"
              hint={
                late
                  ? `Past the ${days}-day return window: defective items only, with the Owner’s approval`
                  : `Some or all, up to ${days} days after the sale`
              }
              disabled={false}
              onClick={() => setSheet('return')}
            />
          )}
          {anyEnabled && (
            <p className="m-0 text-[13px] leading-[1.45] text-neutral-700">
              {isOwner
                ? 'You do these straight away, with a reason; each is audit-logged.'
                : 'Each one goes to the Owner with your reason. Nothing changes until it is approved; you’ll see the answer under My requests.'}
            </p>
          )}
        </section>
      )}
      <VoidSheet
        open={sheet === 'void'}
        onOpenChange={(next) => setSheet(next ? 'void' : null)}
        sale={sale}
        isOwner={isOwner}
        onDone={done}
      />
      {sheet === 'return' && (
        <ReturnSheet
          open
          onOpenChange={(next) => setSheet(next ? 'return' : null)}
          sale={sale}
          isOwner={isOwner}
          onDone={done}
        />
      )}
    </>
  );
}

function ActionRow({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      needsInternet
      disabled={disabled}
      onClick={onClick}
      className="min-h-[60px] w-full justify-start gap-[12px] rounded-[12px] bg-surface px-[14px] text-left text-[15.5px] font-bold"
    >
      <span className="flex flex-1 flex-col gap-[2px]">
        <span>{label}</span>
        <span className="text-[12.5px] font-medium whitespace-normal text-neutral-700">{hint}</span>
      </span>
      <ChevronRight size={20} strokeWidth={ICON_STROKE} aria-hidden />
    </Button>
  );
}

/** The returns already made from this sale. */
function ReturnsMade({ sale }: { sale: SaleDetail }) {
  if (sale.returns.length === 0) return null;
  return (
    <section aria-labelledby="sale-returns" className="flex flex-col gap-[8px]">
      <h2 id="sale-returns" className="font-body text-[15px] font-bold">
        Returns
      </h2>
      {sale.returns.map((ret, index) => (
        <div
          key={index}
          className="flex flex-col gap-[4px] rounded-[12px] bg-surface px-[16px] py-[12px] text-[14px] [font-variant-numeric:tabular-nums]"
        >
          <span>
            <b>
              Returned {when(ret.at)} by {ret.by}
            </b>
            {ret.defective && ' · defective'}
          </span>
          {ret.items.map((item, i) => (
            <span key={i} className="text-neutral-700">
              {item.name} × {formatQty(item.qty)}
              {isSoldByMeasure(item.unit) ? ` ${item.unit}` : ''} ·{' '}
              {item.condition === 'damaged' ? 'damaged' : 'back to stock'} ·{' '}
              {formatPeso(item.refund)}
            </span>
          ))}
          <span>
            Refund {formatPeso(ret.refund)} {METHOD_LABELS[ret.method]}
            {ret.cashRefund !== null && ret.cashRefund !== ret.refund
              ? ` (${formatPeso(ret.cashRefund)} from the drawer)`
              : ''}
            {ret.refundReference && ` · ref ${ret.refundReference}`}
          </span>
          <span className="text-neutral-700">Reason: {ret.reason}</span>
        </div>
      ))}
    </section>
  );
}

const CONDITIONS = [
  { value: 'stock', label: 'Back to stock' },
  { value: 'damaged', label: 'Damaged' },
] as const;

/** POS-10: pick the items, how many, where they go, and how the money goes back. */
function ReturnSheet({
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
  const methods = refundableBy(sale).filter((method) => method.left > 0);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [condition, setCondition] = useState<Record<number, ReturnCondition>>({});
  const [method, setMethod] = useState<PayMethod>(methods[0]?.method ?? 'cash');
  const [defective, setDefective] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { days, late } = sale.returnWindow;

  const lines = sale.lines.filter((line) => leftOf(line) > 0);
  const picks: ReturnPick[] = lines.flatMap((line) => {
    const value = Number((qty[line.lineNo] ?? '').replace(',', '.'));
    return Number.isFinite(value) && value > 0
      ? [{ lineNo: line.lineNo, qty: value, condition: condition[line.lineNo] ?? 'stock' }]
      : [];
  });
  const plan = planRefund(sale, picks, method);
  const left = methods.find((m) => m.method === method)?.left ?? 0;
  const ewallet = method !== 'cash';

  const submit = async () => {
    setError(null);
    for (const line of lines) {
      const raw = (qty[line.lineNo] ?? '').trim();
      if (raw === '') continue;
      const value = Number(raw.replace(',', '.'));
      const whole = !isSoldByMeasure(line.unit);
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (whole && !Number.isInteger(value)) ||
        Math.round(value * 1000) !== value * 1000
      ) {
        setError(
          `${line.name}: ${whole ? 'whole units only' : 'up to 3 decimals'}, for example ${whole ? '1' : '0.5'}.`,
        );
        return;
      }
      if (value > leftOf(line)) {
        setError(`${line.name}: only ${formatQty(leftOf(line))} left to return.`);
        return;
      }
    }
    if (picks.length === 0) {
      setError('Pick at least one item to return.');
      return;
    }
    if (plan.refund > left + (method === 'cash' ? 0.5 : 0)) {
      setError(
        `That is more than was paid by ${METHOD_LABELS[method]} (${formatPeso(left)} left). Pick another way the customer paid, or return fewer items.`,
      );
      return;
    }
    if (late && !defective) {
      setError(`This sale is past the ${days}-day window. Only a defective item can be returned.`);
      return;
    }
    if (!reason.trim()) {
      setError('Say why the items are coming back.');
      return;
    }
    if (isOwner && ewallet && !reference.trim()) {
      setError(`Type the reference of the ${METHOD_LABELS[method]} refund you sent.`);
      return;
    }
    setBusy(true);
    try {
      if (isOwner) {
        await returnSale(sale.id, picks, method, reason, defective, ewallet ? reference : null);
        onDone('Return done. The items are recorded and the refund noted.');
      } else {
        await requestSaleReturn(sale.id, picks, method, reason, defective);
        onDone('Request sent. The Owner will decide; you can follow it in My requests.');
      }
    } catch (caught) {
      setError(describeReturnError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent>
        <SheetTitle>{isOwner ? 'Return items' : 'Ask to return items'}</SheetTitle>
        <SheetDescription>
          How many of each come back, and whether they go back to stock or are damaged.
          {isOwner ? '' : ' Nothing changes until the Owner approves.'}
        </SheetDescription>
        <ul aria-label="Items to return" className="m-0 flex list-none flex-col gap-[10px] p-0">
          {lines.map((line) => {
            const id = `ret-qty-${line.lineNo}`;
            const picked = picks.some((pick) => pick.lineNo === line.lineNo);
            return (
              <li
                key={line.lineNo}
                className="flex flex-col gap-[8px] rounded-[12px] bg-surface px-[14px] py-[12px]"
              >
                <div className="flex items-center gap-[12px]">
                  <Label htmlFor={id} className="flex min-w-0 flex-1 flex-col text-[14px]">
                    <span className="font-semibold">{line.name}</span>
                    <span className="text-[12.5px] text-neutral-700">
                      {formatQty(leftOf(line))}
                      {isSoldByMeasure(line.unit) ? ` ${line.unit}` : ''} left to return ·{' '}
                      {formatPeso(line.lineTotal)} paid
                    </span>
                  </Label>
                  <Input
                    id={id}
                    inputMode={isSoldByMeasure(line.unit) ? 'decimal' : 'numeric'}
                    autoComplete="off"
                    placeholder="0"
                    value={qty[line.lineNo] ?? ''}
                    onChange={(event) =>
                      setQty((prev) => ({ ...prev, [line.lineNo]: event.target.value }))
                    }
                    className="w-[84px] text-right"
                  />
                </div>
                {picked && (
                  <Segmented
                    label={`${line.name}: where it goes`}
                    options={CONDITIONS}
                    value={condition[line.lineNo] ?? 'stock'}
                    onChange={(value) =>
                      setCondition((prev) => ({ ...prev, [line.lineNo]: value }))
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
        {methods.length > 1 && (
          <Segmented
            label="Refund by"
            options={methods.map((m) => ({ value: m.method, label: METHOD_LABELS[m.method] }))}
            value={method}
            onChange={setMethod}
          />
        )}
        <div className="flex flex-col rounded-[12px] bg-surface px-[16px] py-[10px] [font-variant-numeric:tabular-nums]">
          <Row label="Refund" value={formatPeso(plan.refund)} strong />
          {method === 'cash' ? (
            <Row
              label={
                plan.handed !== plan.refund
                  ? 'Cash from today’s drawer, rounded to the peso'
                  : 'Cash from today’s drawer'
              }
              value={formatPeso(plan.handed)}
            />
          ) : (
            <Row
              label={
                isOwner
                  ? `${METHOD_LABELS[method]}: you send it back`
                  : `${METHOD_LABELS[method]}: the Owner sends it back`
              }
              value={formatPeso(plan.refund)}
            />
          )}
        </div>
        {late && (
          <CheckboxField
            label="The item is defective (past the return window)"
            checked={defective}
            onCheckedChange={(checked) => setDefective(checked === true)}
          />
        )}
        <div className="flex flex-col gap-[6px]">
          <Label htmlFor="return-reason" className="text-[13px]">
            Reason
          </Label>
          <Input
            id="return-reason"
            value={reason}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {isOwner && ewallet && (
          <div className="flex flex-col gap-[6px]">
            <Label htmlFor="return-reference" className="text-[13px]">
              {METHOD_LABELS[method]} refund reference
            </Label>
            <Input
              id="return-reference"
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
            {busy ? 'Sending…' : isOwner ? 'Return items' : 'Send to the Owner'}
          </Button>
        </SheetActions>
      </SheetContent>
    </Sheet>
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
