import { Stepper } from '@/components/ui/stepper';
import { formatPeso } from '@/lib/money';
import { cn } from '@/lib/utils';
import { DENOMINATIONS, type Counts } from './data';

const billLabel = (bill: number) => `₱${bill.toLocaleString('en-PH')}`;

/** Round 3: each bill in its peso-note colour, coins grey (SRS 7.2). */
const BILL_COLOUR: Record<number, string> = {
  1000: 'bg-bill-1000',
  500: 'bg-bill-500',
  200: 'bg-bill-200',
  100: 'bg-bill-100',
  50: 'bg-bill-50',
  20: 'bg-bill-20',
};

/** A bill or coin as a small coloured note, for counts and their summaries. */
export function BillChip({ bill, className }: { bill: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-grid h-[30px] w-[62px] flex-none place-items-center rounded-[6px] text-[13px] font-extrabold text-on-bill',
        BILL_COLOUR[bill] ?? 'bg-coin',
        className,
      )}
    >
      {billLabel(bill)}
    </span>
  );
}

/**
 * The bills and coins of a drawer count, ₱1,000 down to ₱1, each with its number and its
 * amount: the closing count (SHIFT-03) and, since Nov 27, 2026, the opening count (SHIFT-01).
 */
export function DenominationList({
  counts,
  onChange,
}: {
  counts: Counts;
  onChange: (counts: Counts) => void;
}) {
  return (
    <ul aria-label="Bills and coins" className="grid content-start md:grid-cols-2 md:gap-x-[24px]">
      {DENOMINATIONS.map((bill) => (
        <li
          key={bill}
          className="flex min-h-[52px] items-center gap-[8px] border-b border-divider md:min-h-[58px]"
        >
          <BillChip bill={bill} />
          <span aria-hidden className="text-[13px] text-neutral-700">
            ×
          </span>
          <Stepper
            editable
            label={`Number of ${billLabel(bill)}`}
            value={counts[bill]}
            max={100000}
            onChange={(value) => onChange({ ...counts, [bill]: value })}
            className="w-[118px] border-0 md:w-[124px]"
          />
          <span className="flex-1 text-right font-heading text-[14.5px] tabular-nums">
            {counts[bill] > 0 ? formatPeso(bill * counts[bill]) : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
