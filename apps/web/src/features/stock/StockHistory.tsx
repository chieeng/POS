import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectClass } from '@/features/catalog/helpers';
import { formatPeso } from '@/lib/money';
import { cn } from '@/lib/utils';
import { MOVEMENT_LABELS, useStockHistory, type HistoryFilter, type MovementType } from './data';
import { formatWhen } from './format';

const TYPES: MovementType[] = [
  'stock_in',
  'stock_in_reversal',
  'adjustment',
  'sale',
  'void',
  'return',
  'count',
];

/**
 * A product's stock history (INV-06) for the Owner and Special Sales, filterable by date and
 * type. The cost per unit shows for the Owner only; the server sends it to no one else.
 */
export function StockHistory({
  productId,
  unit,
  showCost,
}: {
  productId: string;
  unit: string;
  showCost: boolean;
}) {
  const [filter, setFilter] = useState<HistoryFilter>({ from: '', to: '', type: '' });
  const history = useStockHistory(productId, filter);

  return (
    <section className="flex flex-col gap-[8px]" aria-labelledby="stock-history">
      <h2
        id="stock-history"
        className="px-[4px] font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase"
      >
        Stock history
      </h2>
      <div className="flex flex-wrap items-end gap-[10px] px-[4px]">
        <div>
          <Label htmlFor="history-from" className="text-[12.5px]">
            From
          </Label>
          <Input
            id="history-from"
            type="date"
            value={filter.from}
            onChange={(event) => setFilter((current) => ({ ...current, from: event.target.value }))}
            className="min-h-[40px] bg-surface text-[14px]"
          />
        </div>
        <div>
          <Label htmlFor="history-to" className="text-[12.5px]">
            To
          </Label>
          <Input
            id="history-to"
            type="date"
            value={filter.to}
            onChange={(event) => setFilter((current) => ({ ...current, to: event.target.value }))}
            className="min-h-[40px] bg-surface text-[14px]"
          />
        </div>
        <div>
          <Label htmlFor="history-type" className="text-[12.5px]">
            Type
          </Label>
          <select
            id="history-type"
            className={cn(selectClass, 'min-h-[40px] w-auto bg-surface text-[14px]')}
            value={filter.type}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                type: event.target.value as MovementType | '',
              }))
            }
          >
            <option value="">All types</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {MOVEMENT_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {history.error ? (
        <Alert variant="danger">Couldn&apos;t load the stock history.</Alert>
      ) : history.loading ? (
        <p className="px-[4px] text-neutral-700" role="status">
          Loading…
        </p>
      ) : history.data.length === 0 ? (
        <p className="px-[4px] text-[14px] text-neutral-700">No stock movements yet.</p>
      ) : (
        <ul className="rounded-[30px] bg-surface px-[14px] py-[6px] md:px-[22px]">
          {history.data.map((movement) => (
            <li
              key={movement.id}
              className="flex flex-wrap items-baseline gap-x-[10px] gap-y-[2px] border-b border-text/8 py-[10px] text-[14px] last:border-b-0"
            >
              <span className="text-neutral-700">{formatWhen(movement.createdAt)}</span>
              <span>
                {movement.refType === 'stock_receipt' && movement.refId ? (
                  <Link to={`/stock-in/${movement.refId}`}>{MOVEMENT_LABELS[movement.type]}</Link>
                ) : (
                  MOVEMENT_LABELS[movement.type]
                )}
              </span>
              <span
                className={cn(
                  'font-semibold',
                  movement.qtyChange > 0 ? 'text-accent-2-800' : 'text-danger-fg',
                )}
              >
                {movement.qtyChange > 0 ? '+' : '−'}
                {Math.abs(movement.qtyChange)} {unit}
              </span>
              <span className="text-neutral-700">
                → {movement.stockAfter} · {movement.userName}
                {showCost &&
                  movement.unitCost !== null &&
                  ` · ${formatPeso(movement.unitCost)} / ${unit}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
