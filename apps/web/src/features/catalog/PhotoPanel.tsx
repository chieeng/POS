import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Role } from '@/features/auth/roles';
import type { Product } from './data';
import { describePhotoError, removeProductPhoto, replaceProductPhoto } from './photos';
import { ProductPhoto } from './ProductPhoto';

/**
 * The product page's photo (PROD-07). The Owner adds, replaces and removes it. Special Sales
 * adds one to a product without a photo; replacing or removing it is a "Request a change".
 * Sales see it only.
 */
export function PhotoPanel({ product, role }: { product: Product; role: Role | undefined }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'saving' | 'removing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canChoose = role === 'owner' || (role === 'special_sales' && !product.photoKey);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy('saving');
    setError(null);
    setNotice(null);
    try {
      await replaceProductPhoto(product.id, file, product.photoKey);
      setNotice(product.photoKey ? 'Photo replaced.' : 'Photo added.');
    } catch (caught) {
      setError(describePhotoError(caught));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy('removing');
    setError(null);
    setNotice(null);
    try {
      await removeProductPhoto(product.id, product.photoKey);
      setNotice('Photo removed.');
    } catch (caught) {
      setError(describePhotoError(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Photo" className="flex flex-wrap items-end gap-[14px]">
      <ProductPhoto
        productId={product.id}
        photoKey={product.photoKey}
        size={800}
        alt={product.photoKey ? `Photo of ${product.name}` : 'No photo'}
        className="size-[160px] rounded-[24px] bg-surface md:size-[200px]"
      />
      {canChoose && (
        <div className="flex flex-col gap-[8px]">
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={product.photoKey ? 'Replace photo' : 'Add photo'}
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-[10px]">
            <Button
              variant="secondary"
              className="min-h-[44px] px-[18px]"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
            >
              {busy === 'saving'
                ? 'Saving photo…'
                : product.photoKey
                  ? 'Replace photo'
                  : 'Add photo'}
            </Button>
            {role === 'owner' && product.photoKey && (
              <Button
                variant="secondary"
                className="min-h-[44px] px-[18px]"
                disabled={busy !== null}
                onClick={() => void remove()}
              >
                {busy === 'removing' ? 'Removing…' : 'Remove photo'}
              </Button>
            )}
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className="w-full px-[4px] text-[14px] text-neutral-800">
          {notice}
        </p>
      )}
      {error && (
        <Alert variant="danger" className="w-full">
          {error}
        </Alert>
      )}
    </section>
  );
}
