import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';

/**
 * Product photos (PROD-07, SEC-09). Each photo is two JPEGs made in the browser, since the
 * Free plan has no image resizing on the server: a 200 px square for lists and an 800 px one
 * for the product page. The key is new for every photo, so a file never changes and the
 * browser may keep it for a year.
 */
export const PHOTO_BUCKET = 'product-images';
export type PhotoSize = 200 | 800;

const YEAR_SECONDS = '31536000';
// Larger originals are refused before decoding, so an old phone doesn't run out of memory.
export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;

export const photoPath = (productId: string, key: string, size: PhotoSize) =>
  `products/${productId}/${key}-${size}.jpg`;

/** The public link of one size of a photo. */
export const photoUrl = (productId: string, key: string, size: PhotoSize) =>
  supabase.storage.from(PHOTO_BUCKET).getPublicUrl(photoPath(productId, key, size)).data.publicUrl;

/**
 * A JPEG of the image at most `max` px on its longer side; `square` crops the middle to a
 * square first (the list thumbnail). Transparent areas become white.
 */
export async function resizeToJpeg(
  file: Blob,
  max: number,
  quality: number,
  square: boolean,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const source = square
      ? {
          x: (bitmap.width - side) / 2,
          y: (bitmap.height - side) / 2,
          width: side,
          height: side,
        }
      : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, max / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('photo_unreadable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('photo_unreadable'))),
        'image/jpeg',
        quality,
      ),
    );
  } finally {
    bitmap.close();
  }
}

/** Resizes and uploads both sizes of a new photo. Returns its key; nothing shows it yet. */
export async function uploadPhoto(productId: string, file: File): Promise<string> {
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error('photo_too_large');
  let thumb: Blob;
  let full: Blob;
  try {
    [thumb, full] = await Promise.all([
      resizeToJpeg(file, 200, 0.72, true),
      resizeToJpeg(file, 800, 0.8, false),
    ]);
  } catch {
    throw new Error('photo_unreadable');
  }
  const key = crypto.randomUUID();
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  for (const [size, blob] of [
    [200, thumb],
    [800, full],
  ] as const) {
    const { error } = await bucket.upload(photoPath(productId, key, size), blob, {
      cacheControl: YEAR_SECONDS,
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) {
      await deletePhotoFiles(productId, key);
      throw error;
    }
  }
  return key;
}

/**
 * Deletes both files of a photo nothing shows any more. Best effort: the server refuses a
 * photo a product or a pending request still uses, and a leftover file only takes space.
 */
export async function deletePhotoFiles(productId: string, key: unknown): Promise<void> {
  if (typeof key !== 'string' || key === '') return;
  try {
    await supabase.storage
      .from(PHOTO_BUCKET)
      .remove([photoPath(productId, key, 200), photoPath(productId, key, 800)]);
  } catch {
    // Offline or refused: the file stays; nothing points at it.
  }
}

/** The Owner sets, replaces or (null) removes a photo; Special Sales adds the first one. */
export async function setProductPhoto(productId: string, key: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_product_photo', {
    p_product_id: productId,
    p_photo_key: key,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

/** Uploads a photo and puts it on the product, then deletes the one it replaces. */
export async function replaceProductPhoto(
  productId: string,
  file: File,
  oldKey: string | null,
): Promise<void> {
  const key = await uploadPhoto(productId, file);
  try {
    await setProductPhoto(productId, key);
  } catch (caught) {
    await deletePhotoFiles(productId, key);
    throw caught;
  }
  await deletePhotoFiles(productId, oldKey);
}

export async function removeProductPhoto(productId: string, oldKey: string | null): Promise<void> {
  await setProductPhoto(productId, null);
  await deletePhotoFiles(productId, oldKey);
}

export function describePhotoError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (message === 'photo_too_large') return 'This photo is too large. Choose one under 20 MB.';
  if (message === 'photo_unreadable')
    return 'This photo couldn’t be read. Try a JPEG or PNG photo.';
  if (message === 'photo_missing') return 'The photo didn’t finish uploading. Try again.';
  if (code === '42501') return 'Only the Owner can replace or remove a photo. Request a change.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. This needs to be online; try again.';
  }
  return 'The photo couldn’t be saved. Try again.';
}
