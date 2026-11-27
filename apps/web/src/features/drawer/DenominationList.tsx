import { Stepper } from '@/components/ui/stepper';
import { formatPeso } from '@/lib/money';
import { DENOMINATIONS, type Counts } from './data';

const billLabel = (bill: number) => `₱${bill.toLocaleString('en-PH')}`;

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
          className="flex min-h-[52px] items-center gap-[8px] border-b border-text/8 md:min-h-[60px]"
        >
          <span className="w-[68px] text-[15px] font-bold md:w-[60px]">{billLabel(bill)}</span>
          <span aria-hidden className="text-[13px] text-neutral-700 md:hidden">
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
          <span className="flex-1 text-right text-[14.5px] tabular-nums">
            {formatPeso(bill * counts[bill])}
          </span>
        </li>
      ))}
    </ul>
  );
}
