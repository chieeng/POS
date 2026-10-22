import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { useProducts, useSuppliers } from '@/features/catalog/data';
import { PageHeader } from '@/features/settings/PageHeader';
import { formatPeso } from '@/lib/money';
import { useStockReceipt } from './data';
import { formatWhen, receiptTotal } from './format';

/** One stock-in: who, when, supplier, reference and its lines with their costs. */
export function StockReceiptPage() {
  const { receiptId = '' } = useParams();
  const location = useLocation();
  const receipt = useStockReceipt(receiptId);
  const products = useProducts();
  const suppliers = useSuppliers();
  const productById = useMemo(
    () => new Map(products.data.map((product) => [product.id, product])),
    [products.data],
  );
  const found = receipt.data[0];
  const saved = (location.state as { saved?: boolean } | null)?.saved;

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <PageHeader title="Stock-in" backTo="/stock-in" backLabel="Back to stock-ins" alwaysBack />
      {saved && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          Stock-in saved. The stock is updated.
        </p>
      )}
      {receipt.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load this stock-in.</b> Check your connection and reload.
        </Alert>
      ) : receipt.loading || products.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : !found ? (
        <Alert variant="danger">This stock-in was not found.</Alert>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-[8px] rounded-[30px] bg-surface px-[18px] py-[16px] text-[15px] md:px-[22px]">
            <dt className="text-neutral-700">Reference</dt>
            <dd className="font-semibold">{found.reference ?? '—'}</dd>
            <dt className="text-neutral-700">Supplier</dt>
            <dd className="font-semibold">
              {found.supplierId
                ? (suppliers.data.find((supplier) => supplier.id === found.supplierId)?.name ?? '—')
                : '—'}
            </dd>
            <dt className="text-neutral-700">Received</dt>
            <dd className="font-semibold">
              {formatWhen(found.createdAt)} · {found.receivedByName}
            </dd>
          </dl>
          <div className="overflow-x-auto rounded-[30px] bg-surface px-[14px] py-[8px] md:px-[22px]">
            <table className="w-full border-collapse text-left text-[14px]">
              <thead>
                <tr className="text-[12px] text-neutral-700">
                  <th scope="col" className="py-[6px] pr-[10px] font-semibold">
                    #
                  </th>
                  <th scope="col" className="py-[6px] pr-[10px] font-semibold">
                    Product
                  </th>
                  <th scope="col" className="py-[6px] pr-[10px] text-right font-semibold">
                    Qty
                  </th>
                  <th scope="col" className="py-[6px] pr-[10px] text-right font-semibold">
                    Unit cost
                  </th>
                  <th scope="col" className="py-[6px] text-right font-semibold">
                    Line total
                  </th>
                </tr>
              </thead>
              <tbody>
                {found.lines.map((line) => {
                  const product = productById.get(line.productId);
                  return (
                    <tr key={line.lineNo} className="border-t border-text/8">
                      <td className="py-[8px] pr-[10px] text-neutral-700">{line.lineNo}</td>
                      <td className="py-[8px] pr-[10px]">
                        <Link to={`/products/${line.productId}`}>{product?.name ?? 'Product'}</Link>
                        <span className="block text-[12px] text-neutral-700">{product?.sku}</span>
                      </td>
                      <td className="py-[8px] pr-[10px] text-right">
                        {line.qty} {product?.unit}
                      </td>
                      <td className="py-[8px] pr-[10px] text-right">{formatPeso(line.unitCost)}</td>
                      <td className="py-[8px] text-right font-semibold">
                        {formatPeso(line.qty * line.unitCost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-text/20">
                  <td colSpan={4} className="py-[8px] pr-[10px] text-right font-semibold">
                    Total
                  </td>
                  <td className="py-[8px] text-right text-[16px] font-bold">
                    {formatPeso(receiptTotal(found))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
