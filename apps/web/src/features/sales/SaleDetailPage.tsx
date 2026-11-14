import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatPeso } from '@/lib/money';
import { formatQty, isSoldByMeasure } from '@/lib/quantity';
import { ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { fetchSaleDetail, METHOD_LABELS, type SaleDetail } from './history';

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
 * total, and how it was paid. Read-only for now: void, return and correct come in the next
 * step 10 PRs, each through the Owner's approval.
 */
export function SaleDetailPage() {
  const { saleId = '' } = useParams();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; notFound: boolean } | { kind: 'ready'; sale: SaleDetail }
  >({ kind: 'loading' });

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
  }, [saleId]);

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
        <Detail sale={state.sale} isOwner={isOwner} />
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

      <p className="m-0 text-[13px] leading-[1.45] text-neutral-700">
        Something wrong with this sale? Voids, returns and corrections, each sent to the Owner with
        a reason, come in the next update.
      </p>
    </>
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
