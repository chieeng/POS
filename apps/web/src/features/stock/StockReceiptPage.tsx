import { History, PencilLine, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Alert, AlertAction } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProducts, useSuppliers } from '@/features/catalog/data';
import { PageHeader } from '@/features/settings/PageHeader';
import { formatPeso } from '@/lib/money';
import { useSession } from '@/stores/session';
import { CorrectionPanel } from './CorrectionPanel';
import { useStockReceipt } from './data';
import { formatWhen, receiptTotal } from './format';

/**
 * One stock-in: who, when, supplier, reference and its lines with their costs. A corrected
 * stock-in links to its correction, and a correction to what it corrects (INV-04).
 */
export function StockReceiptPage() {
  const { receiptId = '' } = useParams();
  const location = useLocation();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const receipts = useStockReceipt(receiptId);
  const products = useProducts();
  const suppliers = useSuppliers();
  const productById = useMemo(
    () => new Map(products.data.map((product) => [product.id, product])),
    [products.data],
  );
  const found = receipts.data.find((receipt) => receipt.id === receiptId);
  const correction = receipts.data.find((receipt) => receipt.correctsReceiptId === receiptId);
  const state = location.state as { saved?: boolean; corrected?: boolean } | null;

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <PageHeader title="Stock-in" backTo="/stock-in" backLabel="Back to stock-ins" alwaysBack>
        {found?.isDeletion && (
          <StatusBadge tone="pending" icon={Trash2}>
            Deleted
          </StatusBadge>
        )}
        {found?.correctsReceiptId && !found.isDeletion && (
          <StatusBadge tone="accent" icon={PencilLine}>
            Correction
          </StatusBadge>
        )}
        {correction && (
          <StatusBadge tone="pending" icon={History}>
            Corrected
          </StatusBadge>
        )}
      </PageHeader>
      {(state?.saved || state?.corrected) && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          {state.corrected
            ? 'Correction saved. Stock and cost are updated.'
            : 'Stock-in saved. The stock is updated.'}
        </p>
      )}
      {receipts.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load this stock-in.</b> Check your connection and reload.
        </Alert>
      ) : receipts.loading || products.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : !found ? (
        <Alert variant="danger">This stock-in was not found.</Alert>
      ) : (
        <>
          {found.correctsReceiptId && (
            <Alert
              variant="info"
              icon={found.isDeletion ? Trash2 : PencilLine}
              action={
                <AlertAction asChild>
                  <Link to={`/stock-in/${found.correctsReceiptId}`}>
                    Open the original stock-in
                  </Link>
                </AlertAction>
              }
            >
              {found.isDeletion ? 'Deletes' : 'Corrects'} an earlier stock-in
              {found.correctedByName && `, by ${found.correctedByName}`}.
            </Alert>
          )}
          {correction && (
            <Alert
              variant="warn"
              icon={History}
              action={
                <AlertAction asChild>
                  <Link to={`/stock-in/${correction.id}`}>
                    Open the {correction.isDeletion ? 'deletion' : 'correction'}
                  </Link>
                </AlertAction>
              }
            >
              <b>
                {correction.isDeletion ? 'Deleted' : 'Corrected'} on{' '}
                {formatWhen(correction.createdAt)}
                {correction.correctedByName && ` by ${correction.correctedByName}`}.
              </b>{' '}
              This is how it was first recorded; stock and cost follow the{' '}
              {correction.isDeletion ? 'deletion' : 'correction'}.
            </Alert>
          )}
          <Card
            asChild
            size="panel"
            className="grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-[8px] py-[16px] text-[15px]"
          >
            <dl>
              <dt className="text-neutral-700">Reference</dt>
              <dd className="font-semibold">{found.reference ?? '—'}</dd>
              <dt className="text-neutral-700">Supplier</dt>
              <dd className="font-semibold">
                {found.supplierId
                  ? (suppliers.data.find((supplier) => supplier.id === found.supplierId)?.name ??
                    '—')
                  : '—'}
              </dd>
              <dt className="text-neutral-700">Received</dt>
              <dd className="font-semibold">
                {formatWhen(found.createdAt)} · {found.receivedByName}
              </dd>
            </dl>
          </Card>
          {found.isDeletion ? (
            <p className="px-[4px] text-[14px] text-neutral-700">
              No lines: this deletion took every quantity of the earlier stock-in back out of stock.
            </p>
          ) : (
            <Card size="panel">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead numeric>Qty</TableHead>
                    <TableHead numeric>Unit cost</TableHead>
                    <TableHead numeric>Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {found.lines.map((line) => {
                    const product = productById.get(line.productId);
                    return (
                      <TableRow key={line.lineNo}>
                        <TableCell className="text-neutral-700">{line.lineNo}</TableCell>
                        <TableCell className="min-w-[160px]">
                          <Link to={`/products/${line.productId}`}>
                            {product?.name ?? 'Product'}
                          </Link>
                          <span className="block text-[12px] text-neutral-700">{product?.sku}</span>
                        </TableCell>
                        <TableCell numeric>
                          {line.qty} {product?.unit}
                        </TableCell>
                        <TableCell numeric>{formatPeso(line.unitCost)}</TableCell>
                        <TableCell numeric className="font-semibold">
                          {formatPeso(line.qty * line.unitCost)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <tfoot>
                  <tr>
                    <TableCell colSpan={4} numeric className="border-b-0 font-semibold">
                      Total
                    </TableCell>
                    <TableCell numeric className="border-b-0 text-[16px] font-bold">
                      {formatPeso(receiptTotal(found))}
                    </TableCell>
                  </tr>
                </tfoot>
              </Table>
            </Card>
          )}
          {!correction && !found.isDeletion && (
            <CorrectionPanel
              key={found.id}
              receipt={found}
              products={productById}
              suppliers={suppliers.data}
              isOwner={isOwner}
            />
          )}
        </>
      )}
    </div>
  );
}
