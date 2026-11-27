import { ChevronDown, CloudCheck, CloudOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { watchOutboxItem } from '@/lib/outbox';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PROVIDER_LABELS } from '@/features/store/data';
import { formatPeso } from '@/lib/money';
import { formatQty, isSoldByMeasure } from '@/lib/quantity';
import { cn, ICON_STROKE } from '@/lib/utils';
import type { Slip } from './checkout';

const when = (date: Date) =>
  date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const signed = (amount: number) => `${amount < 0 ? '−' : '+'}${formatPeso(Math.abs(amount))}`;

/**
 * POS-07: the digital slip, on screen only (no Share or Print: the owner's decision of Nov 1,
 * 2026). Store details, receipt number, items, totals with the cash rounding, VAT when the
 * store is VAT registered, payments, salesperson, and always "This is not an official receipt".
 */
export function SaleSlip({ slip, onNewSale }: { slip: Slip; onNewSale: () => void }) {
  const sending = useSending(slip);
  // Round 3: the change to give is the main thing; the slip is one tap away on a phone and
  // beside it on a tablet or laptop.
  const [showSlip, setShowSlip] = useState(false);
  const cash = slip.payments.find((payment) => payment.method === 'cash');
  return (
    <section
      aria-label="Sale complete"
      className="mx-auto grid w-full max-w-[480px] content-start gap-[14px] px-[18px] pt-[6px] pb-[24px] md:max-w-[900px] md:grid-cols-[minmax(0,1fr)_minmax(0,400px)] md:gap-[32px] md:pt-[32px]"
    >
      <div className="flex flex-col gap-[14px]">
        <h1 className="text-[24px] md:text-[28px]">Sale complete</h1>
        <div className="flex flex-col items-center gap-[2px] rounded-[16px] bg-surface px-[18px] py-[24px] text-center shadow-[var(--shadow-md)]">
          {slip.change > 0 ? (
            <>
              <span className="text-[15px] text-neutral-700">Give change</span>
              <span className="font-heading text-[52px] leading-[1.1]">
                {formatPeso(slip.change)}
              </span>
            </>
          ) : (
            <>
              <span className="text-[15px] text-neutral-700">No change to give</span>
              <span className="font-heading text-[40px] leading-[1.1]">
                {formatPeso(slip.total)}
              </span>
            </>
          )}
          <span className="text-[13.5px] text-neutral-700">
            {cash && slip.tendered !== null
              ? `Cash ${formatPeso(slip.tendered)} · total ${formatPeso(slip.total)}`
              : `Total ${formatPeso(slip.total)}`}
          </span>
        </div>

        {sending === 'waiting' && (
          <Alert variant="offline" icon={CloudOff}>
            Saved on this phone. It is sent to the store as soon as there is a connection;
            don&apos;t sign out until it has.
          </Alert>
        )}
        {sending === 'sent' && (
          <Alert variant="info" icon={CloudCheck}>
            Sent to the store.
          </Alert>
        )}
        {sending !== null && typeof sending === 'object' && (
          <Alert variant="danger">
            <b>The store refused this sale.</b> {sending.refused} It stays on this phone and the
            Owner has been told.
          </Alert>
        )}

        <button
          type="button"
          aria-expanded={showSlip}
          onClick={() => setShowSlip((value) => !value)}
          className="flex min-h-[48px] items-center gap-[8px] border-b border-divider text-left text-[15px] text-neutral-700 md:hidden"
        >
          <span className="flex-1">{showSlip ? 'Hide slip' : 'Show slip'}</span>
          <ChevronDown
            size={18}
            strokeWidth={ICON_STROKE}
            className={showSlip ? 'rotate-180' : undefined}
            aria-hidden
          />
        </button>
        <Button
          className="order-last min-h-[56px] w-full text-[18px] md:order-none"
          onClick={onNewSale}
        >
          New sale
        </Button>
      </div>

      <article
        aria-label={`Slip ${slip.receiptNo}`}
        className={cn(
          'flex-col gap-[10px] rounded-[12px] border border-divider bg-surface px-[20px] pt-[20px] pb-[16px] [font-variant-numeric:tabular-nums] md:flex',
          showSlip ? 'flex' : 'hidden',
        )}
      >
        <header className="text-center leading-[1.35]">
          <div className="font-heading text-[19px]">{slip.store.name}</div>
          {slip.store.address && (
            <div className="text-[12px] text-neutral-700">{slip.store.address}</div>
          )}
          {slip.store.contact && (
            <div className="text-[12px] text-neutral-700">{slip.store.contact}</div>
          )}
          {slip.store.tin && (
            <div className="text-[12px] text-neutral-700">TIN {slip.store.tin}</div>
          )}
        </header>
        {/* The receipt number never wraps: it has a line of its own, the date and time below. */}
        <div className="flex flex-col gap-[1px] text-[12.5px] text-neutral-800">
          <span className="whitespace-nowrap">Receipt {slip.receiptNo}</span>
          <span>{when(slip.madeAt)}</span>
        </div>

        <ul className="flex flex-col gap-[6px] border-y border-dashed border-neutral-400 py-[10px]">
          {slip.lines.map((line, index) => (
            <li key={index} className="flex gap-[8px] text-[13.5px]">
              <span className="flex-1">
                {line.name}
                <br />
                <span className="text-[12px] text-neutral-700">
                  {formatQty(line.qty)}
                  {isSoldByMeasure(line.unit) ? ` ${line.unit}` : ''} × {formatPeso(line.unitPrice)}
                  {line.discount && ` · ${line.discount.name} −${formatPeso(line.discount.amount)}`}
                </span>
              </span>
              <span>{formatPeso(line.total)}</span>
            </li>
          ))}
        </ul>

        <dl className="flex flex-col gap-[3px] text-[13.5px]">
          <Row label="Subtotal" value={formatPeso(slip.subtotal)} />
          {slip.discountTotal > 0 && (
            <Row label="Discount" value={`−${formatPeso(slip.discountTotal)}`} />
          )}
          {slip.rounding !== 0 && <Row label="Rounding" value={signed(slip.rounding)} />}
          <Row label="Total" value={formatPeso(slip.total)} strong />
          {slip.vatRate !== null && slip.vatAmount !== null && (
            <Row label={`VAT ${slip.vatRate}% included`} value={formatPeso(slip.vatAmount)} />
          )}
          {slip.payments.map((payment, index) =>
            payment.method === 'cash' ? (
              <Row key={index} label="Cash" value={formatPeso(slip.tendered ?? payment.amount)} />
            ) : (
              <Row
                key={index}
                label={`${PROVIDER_LABELS[payment.method]}${payment.accountLabel ? ` · ${payment.accountLabel}` : ''} · Ref ${payment.reference ?? ''}`}
                value={formatPeso(payment.amount)}
              />
            ),
          )}
          {slip.tendered !== null && <Row label="Change" value={formatPeso(slip.change)} />}
        </dl>

        <div className="text-[12.5px] text-neutral-800">Salesperson: {slip.salesperson}</div>
        {slip.store.receiptFooter && (
          <div className="text-center text-[12px]">{slip.store.receiptFooter}</div>
        )}
        <div className="text-center text-[12px] font-bold tracking-[0.04em] text-neutral-700 uppercase">
          This is not an official receipt
        </div>
      </article>
    </section>
  );
}

type Sending = null | 'waiting' | 'sent' | { refused: string };

/**
 * A sale made offline: its note follows the outbox, so once it is sent the slip says so
 * instead of still asking staff not to sign out. A sale sent at once needs no note.
 */
function useSending(slip: Slip): Sending {
  const [state, setState] = useState<Sending>(slip.status === 'waiting' ? 'waiting' : null);
  useEffect(() => {
    if (slip.status !== 'waiting') return;
    return watchOutboxItem(slip.id, (item) => {
      if (!item) setState('sent');
      else if (item.status === 'needsAttention') setState({ refused: item.error ?? 'Refused.' });
      else setState('waiting');
    });
  }, [slip.id, slip.status]);
  return state;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={
        strong ? 'flex justify-between text-[16px] font-bold' : 'flex justify-between gap-[8px]'
      }
    >
      <dt>{label}</dt>
      <dd className="whitespace-nowrap">{value}</dd>
    </div>
  );
}
