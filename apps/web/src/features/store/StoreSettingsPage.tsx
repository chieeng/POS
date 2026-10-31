import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink, LocateFixed } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/features/settings/PageHeader';
import { ICON_STROKE } from '@/lib/utils';
import { describeSaveError, updateBranchSettings, useBranch, type BranchSettings } from './data';
import {
  currentLocation,
  formatCoordinates,
  LocationError,
  mapsUrl,
  parseCoordinates,
  type Fix,
} from './geo';
import {
  storeDetailsSchema,
  storeLocationSchema,
  type StoreDetailsValues,
  type StoreLocationValues,
} from './schemas';

const sectionClass =
  'flex flex-col gap-[14px] rounded-[30px] bg-surface px-[18px] py-[18px] md:px-[22px]';
const headingClass = 'font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase';
const inputClass = 'min-h-[48px] bg-bg text-[15px]';

// Above this, a phone's reading is probably not good enough to set the store's location.
const GOOD_ACCURACY_M = 30;

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-[5px] text-[13px] text-danger-fg">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-[5px] text-[12.5px] text-neutral-700">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const describedBy = (id: string, error?: unknown, hint = true) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

const detailsFrom = (branch: BranchSettings): StoreDetailsValues => ({
  name: branch.name,
  address: branch.address ?? '',
  contact: branch.contact ?? '',
  tin: branch.tin ?? '',
  receiptFooter: branch.receiptFooter ?? '',
  discountLimit: branch.salesDiscountLimit === null ? '' : String(branch.salesDiscountLimit),
  idleLockMinutes: String(branch.idleLockMinutes),
});

const locationFrom = (branch: BranchSettings): StoreLocationValues => ({
  coordinates:
    branch.storeLat === null || branch.storeLng === null
      ? ''
      : formatCoordinates(branch.storeLat, branch.storeLng),
  radius: String(branch.radiusM),
});

/** Settings > Store (SYS-01): the store's details and its location for clock-in (ATT-02). */
export function StoreSettingsPage() {
  const { branch, loading, error } = useBranch();

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <PageHeader title="Store" backTo="/settings" backLabel="Back to settings" />
      {error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the store settings.</b> Check your connection and reload.
        </Alert>
      ) : loading || !branch ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : (
        <>
          <StoreDetailsForm branch={branch} />
          <StoreLocationForm branch={branch} />
        </>
      )}
    </div>
  );
}

function StoreDetailsForm({ branch }: { branch: BranchSettings }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<StoreDetailsValues>({
    resolver: zodResolver(storeDetailsSchema),
    defaultValues: detailsFrom(branch),
  });

  // Keep the form in step with changes saved elsewhere, unless the Owner is editing it.
  useEffect(() => {
    if (!isDirty) reset(detailsFrom(branch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSaved(false);
    try {
      await updateBranchSettings({
        name: values.name,
        address: values.address || null,
        contact: values.contact || null,
        tin: values.tin || null,
        receipt_footer: values.receiptFooter || null,
        sales_discount_limit: values.discountLimit === '' ? null : Number(values.discountLimit),
        idle_lock_minutes: Number(values.idleLockMinutes),
      });
      reset(values);
      setSaved(true);
    } catch (caught) {
      setError(describeSaveError(caught));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className={sectionClass} aria-labelledby="details-heading">
      <h2 id="details-heading" className={headingClass}>
        Store details
      </h2>
      {error && <Alert variant="danger">{error}</Alert>}

      <Field id="store-name" label="Store name" error={errors.name?.message}>
        <Input
          id="store-name"
          autoComplete="organization"
          className={inputClass}
          aria-invalid={!!errors.name || undefined}
          aria-describedby={describedBy('store-name', errors.name, false)}
          {...register('name')}
        />
      </Field>
      <Field id="store-address" label="Address" error={errors.address?.message}>
        <Input
          id="store-address"
          autoComplete="street-address"
          className={inputClass}
          aria-invalid={!!errors.address || undefined}
          aria-describedby={describedBy('store-address', errors.address, false)}
          {...register('address')}
        />
      </Field>
      <Field
        id="store-contact"
        label="Contact number"
        hint="Shown on receipts."
        error={errors.contact?.message}
      >
        <Input
          id="store-contact"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className={inputClass}
          aria-invalid={!!errors.contact || undefined}
          aria-describedby={describedBy('store-contact', errors.contact)}
          {...register('contact')}
        />
      </Field>
      <Field
        id="store-tin"
        label="TIN"
        hint="Optional, for example 123-456-789-000."
        error={errors.tin?.message}
      >
        <Input
          id="store-tin"
          inputMode="numeric"
          autoComplete="off"
          className={inputClass}
          aria-invalid={!!errors.tin || undefined}
          aria-describedby={describedBy('store-tin', errors.tin)}
          {...register('tin')}
        />
      </Field>
      <Field
        id="store-footer"
        label="Receipt footer"
        hint="A short line at the bottom of every slip, for example “Thank you, come again!”"
        error={errors.receiptFooter?.message}
      >
        <Input
          id="store-footer"
          autoComplete="off"
          className={inputClass}
          aria-invalid={!!errors.receiptFooter || undefined}
          aria-describedby={describedBy('store-footer', errors.receiptFooter)}
          {...register('receiptFooter')}
        />
      </Field>
      <Field
        id="store-discount"
        label="Discount limit per sale (₱)"
        hint="Staff can give discounts up to this amount without your approval. Leave empty: every discount needs approval."
        error={errors.discountLimit?.message}
      >
        <Input
          id="store-discount"
          inputMode="decimal"
          autoComplete="off"
          className={inputClass}
          aria-invalid={!!errors.discountLimit || undefined}
          aria-describedby={describedBy('store-discount', errors.discountLimit)}
          {...register('discountLimit')}
        />
      </Field>
      <Field
        id="store-idle"
        label="Lock after (minutes idle)"
        hint="The app asks for the password again after this long without use, on every device."
        error={errors.idleLockMinutes?.message}
      >
        <Input
          id="store-idle"
          inputMode="numeric"
          autoComplete="off"
          className={`${inputClass} max-w-[140px]`}
          aria-invalid={!!errors.idleLockMinutes || undefined}
          aria-describedby={describedBy('store-idle', errors.idleLockMinutes)}
          {...register('idleLockMinutes')}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-[12px]">
        <Button
          needsInternet
          type="submit"
          className="min-h-[46px] px-[22px]"
          disabled={isSubmitting || !isDirty}
        >
          {isSubmitting ? 'Saving…' : 'Save details'}
        </Button>
        {saved && !isDirty && (
          <span role="status" className="text-[13.5px] text-neutral-700">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}

function StoreLocationForm({ branch }: { branch: BranchSettings }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<StoreLocationValues>({
    resolver: zodResolver(storeLocationSchema),
    defaultValues: locationFrom(branch),
  });

  useEffect(() => {
    if (!isDirty) reset(locationFrom(branch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const isSet = branch.storeLat !== null && branch.storeLng !== null;

  const readMyLocation = async () => {
    setError(null);
    setSaved(false);
    setLocating(true);
    try {
      const reading = await currentLocation();
      setFix(reading);
      setValue('coordinates', formatCoordinates(reading.lat, reading.lng), {
        shouldDirty: true,
        shouldValidate: true,
      });
    } catch (caught) {
      setError(
        caught instanceof LocationError ? caught.message : 'The location could not be read.',
      );
    } finally {
      setLocating(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSaved(false);
    const point = values.coordinates === '' ? null : parseCoordinates(values.coordinates);
    try {
      await updateBranchSettings({
        store_lat: point?.lat ?? null,
        store_lng: point?.lng ?? null,
        radius_m: Number(values.radius),
      });
      reset(values);
      setFix(null);
      setSaved(true);
    } catch (caught) {
      setError(describeSaveError(caught));
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={sectionClass}
      aria-labelledby="location-heading"
    >
      <h2 id="location-heading" className={headingClass}>
        Store location for clock-in
      </h2>
      {!isSet && (
        <Alert variant="warn">
          <span>
            <b>Store location not set.</b> The location check at clock-in is off until you set it.
            Use your current location while you are inside the store, or type the coordinates.
          </span>
        </Alert>
      )}
      {error && <Alert variant="danger">{error}</Alert>}

      <Button
        type="button"
        variant="secondary"
        className="min-h-[46px] self-start px-[18px]"
        onClick={() => void readMyLocation()}
        disabled={locating || isSubmitting}
      >
        <LocateFixed size={17} strokeWidth={ICON_STROKE} aria-hidden />
        {locating ? 'Finding your location…' : 'Use my current location'}
      </Button>
      {fix && (
        <p
          role="status"
          className={
            fix.accuracy > GOOD_ACCURACY_M
              ? 'text-[13.5px] text-warn-fg'
              : 'text-[13.5px] text-neutral-700'
          }
        >
          {fix.accuracy > GOOD_ACCURACY_M
            ? `Accurate to about ±${Math.round(fix.accuracy)} m only. For a better reading, stand inside the store near the entrance with GPS on and try again, or type the coordinates from Google Maps.`
            : `Found, accurate to about ±${Math.round(fix.accuracy)} m. Save to use it.`}
        </p>
      )}

      <Field
        id="store-coordinates"
        label="Coordinates (latitude, longitude)"
        hint="For example 14.599512, 120.984219. In Google Maps, press and hold the store to copy them. Leave empty to turn the location check off."
        error={errors.coordinates?.message}
      >
        <Input
          id="store-coordinates"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
          aria-invalid={!!errors.coordinates || undefined}
          aria-describedby={describedBy('store-coordinates', errors.coordinates)}
          {...register('coordinates')}
        />
      </Field>
      <Field
        id="store-radius"
        label="Allowed distance (metres)"
        hint="Staff can clock in within this distance of the store. 100 m suits most stores."
        error={errors.radius?.message}
      >
        <Input
          id="store-radius"
          inputMode="numeric"
          autoComplete="off"
          className={`${inputClass} max-w-[140px]`}
          aria-invalid={!!errors.radius || undefined}
          aria-describedby={describedBy('store-radius', errors.radius)}
          {...register('radius')}
        />
      </Field>
      {isSet && branch.storeLat !== null && branch.storeLng !== null && (
        <a
          href={mapsUrl(branch.storeLat, branch.storeLng)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-[6px] self-start text-[14px]"
        >
          Check the saved location on Google Maps
          <ExternalLink size={14} strokeWidth={ICON_STROKE} aria-hidden />
        </a>
      )}

      <div className="flex flex-wrap items-center gap-[12px]">
        <Button
          needsInternet
          type="submit"
          className="min-h-[46px] px-[22px]"
          disabled={isSubmitting || !isDirty}
        >
          {isSubmitting ? 'Saving…' : 'Save location'}
        </Button>
        {saved && !isDirty && (
          <span role="status" className="text-[13.5px] text-neutral-700">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
