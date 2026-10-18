import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/features/settings/PageHeader';
import { createProduct, describeCatalogError, useCategories } from './data';
import { toFields } from './helpers';
import { ProductForm } from './ProductForm';

/** Products > Add product (PROD-02, PROD-03): the Owner and Special Sales. */
export function AddProductPage() {
  const navigate = useNavigate();
  const categories = useCategories();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex max-w-[560px] flex-col gap-[14px]">
      <PageHeader title="Add product" backTo="/products" backLabel="Back to products" alwaysBack />
      {error && <Alert variant="danger">{error}</Alert>}
      {categories.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : (
        <ProductForm
          defaultValues={{
            sku: '',
            name: '',
            categoryId: '',
            unit: 'pc',
            sellPrice: '',
            reorderLevel: '0',
          }}
          categories={categories.data}
          submitLabel="Add product"
          submittingLabel="Adding…"
          onSubmit={async (values) => {
            setError(null);
            try {
              const id = await createProduct(toFields(values));
              navigate(`/products/${id}`, { state: { added: true } });
            } catch (caught) {
              setError(describeCatalogError(caught, 'product'));
            }
          }}
          onCancel={() => navigate('/products')}
        />
      )}
    </div>
  );
}
