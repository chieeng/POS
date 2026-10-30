import { Package } from 'lucide-react';
import { useState } from 'react';
import { cn, ICON_STROKE } from '@/lib/utils';
import { photoUrl, type PhotoSize } from './photos';

/**
 * A product's photo, or a plain package icon when it has none or the file doesn't load.
 * Lists use the 200 px file; the product page the 800 px one. `alt` is empty where the
 * product's name is right next to it.
 */
export function ProductPhoto({
  productId,
  photoKey,
  size,
  className,
  alt = '',
}: {
  productId: string;
  photoKey: string | null | undefined;
  size: PhotoSize;
  className?: string;
  alt?: string;
}) {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const show = typeof photoKey === 'string' && photoKey !== '' && failedKey !== photoKey;
  return (
    <span
      className={cn(
        'flex flex-none items-center justify-center overflow-hidden bg-text/5 text-neutral-700',
        className,
      )}
    >
      {show ? (
        <img
          src={photoUrl(productId, photoKey, size)}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          className={cn('size-full', size === 200 ? 'object-cover' : 'object-contain')}
          onError={() => setFailedKey(photoKey)}
        />
      ) : (
        <Package
          size={size === 200 ? 20 : 40}
          strokeWidth={ICON_STROKE}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
        />
      )}
    </span>
  );
}
