import { ChevronRight, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { useSuppliers } from '@/features/catalog/data';
import { formatPeso } from '@/lib/money';
import { ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { useStockReceipts } from './data';
import { formatWhen, receiptTotal } from './format';

/** Stock-in (INV-02): the Owner sees every stock-in; Special Sales sees their own. */
export function StockInListPage() {
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const receipts = useStockReceipts();
  const suppliers = useSuppliers();
  const corrected = useMemo(
    () =>
      new Set(
        receipts.data.flatMap((receipt) =>
          receipt.correctsReceiptId ? [receipt.correctsReceiptId] : [],
        ),
      ),
    [receipts.data],
  );
  const supplierName = useMemo(
    () => new Map(suppliers.data.map((supplier) => [supplier.id, supplier.name])),
    [suppliers.data],
  );

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <h1 className="flex-1 text-[28px] md:text-[30px]">Stock-in</h1>
        <Button asChild className="min-h-[46px] px-[18px]">
          <Link to="new">
            <Plus size={17} strokeWidth={ICON_STROKE} aria-hidden />
            New stock-in
          </Link>
        </Button>
      </div>
      <p className="px-[4px] text-[13.5px] text-neutral-700">
        {isOwner
          ? 'Every delivery and the opening stock, newest first.'
          : 'The stock-ins you recorded, newest first.'}
      </p>

      {receipts.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the stock-ins.</b> Check your connection and reload.
        </Alert>
      ) : receipts.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : receipts.data.length === 0 ? (
        <p className="px-[4px] text-neutral-700">
          No stock-ins yet. Start with the opening stock: what is on the shelves today.
        </p>
      ) : (
        <ul className="rounded-[30px] bg-surface px-[8px] py-[6px] md:px-[14px]">
          {receipts.data.map((receipt) => (
            <li key={receipt.id} className="border-b border-text/8 last:border-b-0">
              <Link
                to={receipt.id}
                className="flex min-h-[60px] items-center gap-[12px] rounded-[18px] px-[8px] py-[8px] text-text no-underline hover:bg-text/5"
              >
                <span className="min-w-0 flex-1 leading-[1.3]">
                  <span className="block truncate text-[15px] font-semibold">
                    {receipt.reference ?? 'No reference'}
                    {receipt.supplierId &&
                      ` · ${supplierName.get(receipt.supplierId) ?? 'Supplier'}`}
                  </span>
                  <span className="block truncate text-[12.5px] text-neutral-700">
                    {formatWhen(receipt.createdAt)} · {receipt.receivedByName}
                    {receipt.correctedByName &&
                      receipt.correctedByName !== receipt.receivedByName &&
                      ` · corrected by ${receipt.correctedByName}`}{' '}
                    · {receipt.lines.length} {receipt.lines.length === 1 ? 'line' : 'lines'}
                  </span>
                </span>
                {receipt.isDeletion && <Tag variant="muted">Deleted</Tag>}
                {receipt.correctsReceiptId && !receipt.isDeletion && (
                  <Tag variant="accent-2">Correction</Tag>
                )}
                {corrected.has(receipt.id) && <Tag variant="neutral">Corrected</Tag>}
                <span className="text-[15px] font-semibold">
                  {formatPeso(receiptTotal(receipt))}
                </span>
                <ChevronRight
                  size={17}
                  strokeWidth={ICON_STROKE}
                  className="flex-none text-neutral-700"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
