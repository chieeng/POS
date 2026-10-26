import { useMemo } from 'react';
import { useCategories, useProducts, useSuppliers } from '@/features/catalog/data';
import { useStockReceipts } from '@/features/stock/data';
import { isOutdated, type ApprovalRequest } from './data';

/**
 * What the Approvals and My requests pages need to show any request: products, categories,
 * suppliers and stock-ins (all of them for the Owner; one's own for Special Sales).
 */
export function useRequestContext() {
  const products = useProducts();
  const categories = useCategories();
  const suppliers = useSuppliers();
  const receipts = useStockReceipts(300);

  return useMemo(() => {
    const productById = new Map(products.data.map((product) => [product.id, product]));
    const receiptById = new Map(receipts.data.map((receipt) => [receipt.id, receipt]));
    const corrected = new Set(
      receipts.data.flatMap((receipt) =>
        receipt.correctsReceiptId ? [receipt.correctsReceiptId] : [],
      ),
    );
    return {
      loading: products.loading || categories.loading || receipts.loading,
      error: products.error,
      productById,
      receiptById,
      categories: categories.data,
      suppliers: suppliers.data,
      outdated: (request: ApprovalRequest) =>
        isOutdated(request, productById.get(request.productId), corrected.has(request.targetId)),
      /** "Chips Classic", "Stock adjustment · Chips Classic", "Stock-in correction · DR 1234". */
      title: (request: ApprovalRequest): { label: string; to: string } => {
        if (request.type === 'stock_in_correction') {
          const receipt = receiptById.get(request.targetId);
          return {
            label: `Stock-in correction · ${receipt?.reference ?? 'stock-in'}`,
            to: `/stock-in/${request.targetId}`,
          };
        }
        const name = productById.get(request.productId)?.name ?? 'Product';
        return {
          label: request.type === 'stock_adjustment' ? `Stock adjustment · ${name}` : name,
          to: `/products/${request.productId}`,
        };
      },
    };
  }, [products, categories, suppliers, receipts]);
}

export type RequestContext = ReturnType<typeof useRequestContext>;
