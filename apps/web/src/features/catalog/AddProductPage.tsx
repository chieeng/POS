import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/features/settings/PageHeader';
import { createProduct, describeCatalogError, useCategories } from './data';
import { toFields } from './helpers';
import { replaceProductPhoto } from './photos';
import { ProductForm } from './ProductForm';

/**
 * Products > Add product (PROD-02, PROD-03): the Owner and Special Sales, with an optional
 * photo (PROD-07), saved once the product exists.
 */
export function AddProductPage() {
  const navigate = useNavigate();
  const categories = useCategories();
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);

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
            let id: string;
            try {
              id = await createProduct(toFields(values));
            } catch (caught) {
              setError(describeCatalogError(caught, 'product'));
              return;
            }
            let photoFailed = false;
            if (photo) {
              try {
                await replaceProductPhoto(id, photo, null);
              } catch {
                photoFailed = true;
              }
            }
            navigate(`/products/${id}`, { state: { added: true, photoFailed } });
          }}
          onCancel={() => navigate('/products')}
          onEdit={() => setError(null)}
        >
          <div>
            <Label htmlFor="product-photo" className="text-[13px]">
              Photo (optional)
            </Label>
            <input
              id="product-photo"
              type="file"
              accept="image/*"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              className="block text-[14px]"
            />
          </div>
        </ProductForm>
      )}
    </div>
  );
}
