import { useRef } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Chooses a photo to save later (Add product, a photo request), with the same button as the
 * product page's Add photo instead of the browser's own file field. Give it `id` for a visible
 * <Label htmlFor>, or `label` when there is none.
 */
export function PhotoPicker({
  id,
  label,
  file,
  onChange,
}: {
  id?: string;
  label?: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={label}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <Button variant="secondary" size="md" onClick={() => input.current?.click()}>
        {file ? 'Change photo' : 'Choose photo'}
      </Button>
      {file && (
        <>
          <span className="min-w-0 truncate text-[14px] text-neutral-800">{file.name}</span>
          <Button
            variant="quiet"
            size="touch"
            onClick={() => {
              if (input.current) input.current.value = '';
              onChange(null);
            }}
          >
            Remove
          </Button>
        </>
      )}
    </div>
  );
}
