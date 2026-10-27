import { ADJUSTMENT_LABELS, type AdjustmentType } from '@/features/stock/data';
import { formatPeso } from '@/lib/money';
import type { RequestContext } from './context';
import type { ApprovalRequest } from './data';
import { RequestChanges } from './RequestChanges';

interface LineValue {
  product_id?: string;
  qty?: number;
  unit_cost?: number;
}

const lines = (value: unknown): LineValue[] => (Array.isArray(value) ? (value as LineValue[]) : []);

/** What a request asks for, whatever its type. */
export function RequestDetails({
  request,
  context,
  outdated,
}: {
  request: ApprovalRequest;
  context: RequestContext;
  outdated: boolean;
}) {
  if (request.type === 'product_edit') {
    return (
      <RequestChanges
        request={request}
        product={context.productById.get(request.productId)}
        categories={context.categories}
        outdated={outdated}
      />
    );
  }

  if (request.type === 'stock_adjustment') {
    const product = context.productById.get(request.productId);
    const qty = Number(request.after.qty);
    const type = String(request.after.type) as AdjustmentType;
    return (
      <p className="text-[15px]">
        <b>{ADJUSTMENT_LABELS[type] ?? type}</b>:{' '}
        <b className={qty < 0 ? 'text-danger-fg' : 'text-accent-2-800'}>
          {qty > 0 ? '+' : '−'}
          {Math.abs(qty)} {product?.unit}
        </b>
        <span className="text-neutral-700"> · now {product?.stockQty ?? '—'} in stock</span>
      </p>
    );
  }

  // A stock-in correction or deletion: the lines as recorded and as requested.
  const before = lines(request.before.lines);
  const after = new Map(lines(request.after.lines).map((line) => [line.product_id, line]));
  const supplierName = (id: unknown) =>
    typeof id === 'string'
      ? (context.suppliers.find((supplier) => supplier.id === id)?.name ?? '—')
      : '—';
  const deleting = request.after.delete === true;

  return (
    <div className="flex flex-col gap-[8px] text-[14px]">
      {deleting && (
        <p className="text-[15px] font-semibold text-danger-fg">
          Delete this stock-in: every quantity on it comes back out of stock.
        </p>
      )}
      {!deleting && request.before.supplier_id !== request.after.supplier_id && (
        <p>
          <span className="text-neutral-700">Supplier: </span>
          {supplierName(request.before.supplier_id)} →{' '}
          <b>{supplierName(request.after.supplier_id)}</b>
        </p>
      )}
      {!deleting && (request.before.reference ?? null) !== (request.after.reference ?? null) && (
        <p>
          <span className="text-neutral-700">Reference: </span>
          {String(request.before.reference ?? '—')} →{' '}
          <b>{String(request.after.reference ?? '—')}</b>
        </p>
      )}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[12px] text-neutral-700">
            <th scope="col" className="py-[4px] pr-[10px] font-semibold">
              Product
            </th>
            <th scope="col" className="py-[4px] pr-[10px] font-semibold">
              Recorded
            </th>
            <th scope="col" className="py-[4px] font-semibold">
              Requested
            </th>
          </tr>
        </thead>
        <tbody>
          {before.map((line) => {
            const product = context.productById.get(line.product_id ?? '');
            const wanted = deleting
              ? { qty: 0, unit_cost: line.unit_cost }
              : after.get(line.product_id);
            const changed = wanted?.qty !== line.qty || wanted?.unit_cost !== line.unit_cost;
            return (
              <tr key={line.product_id} className="border-t border-text/8 align-top">
                <th scope="row" className="py-[6px] pr-[10px] font-normal">
                  {product?.name ?? 'Product'}
                </th>
                <td className="py-[6px] pr-[10px]">
                  {line.qty} @ {formatPeso(Number(line.unit_cost))}
                </td>
                <td className={changed ? 'py-[6px] font-semibold' : 'py-[6px] text-neutral-700'}>
                  {wanted?.qty === 0
                    ? 'removed'
                    : `${wanted?.qty} @ ${formatPeso(Number(wanted?.unit_cost))}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
