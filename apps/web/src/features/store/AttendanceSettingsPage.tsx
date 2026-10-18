import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { PageHeader } from '@/features/settings/PageHeader';
import { describeSaveError, updateBranchSettings, useBranch, type BranchSettings } from './data';
import { attendanceSchema, LATE_DEDUCTION_OPTIONS, type AttendanceValues } from './schemas';

const sectionClass =
  'flex flex-col gap-[14px] rounded-[30px] bg-surface px-[18px] py-[18px] md:px-[22px]';
const headingClass = 'font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase';
const inputClass = 'min-h-[48px] bg-bg text-[15px]';

/** The daily rate used in the example under "Late deduction". Only an illustration. */
const EXAMPLE_RATE = 600;
const EXAMPLE_MINUTES = 10;

const peso = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

const describedBy = (id: string, error?: unknown) => (error ? `${id}-error` : `${id}-hint`);

const valuesFrom = (branch: BranchSettings): AttendanceValues => ({
  morningClockIn: branch.morningClockIn,
  afternoonClockIn: branch.afternoonClockIn,
  graceMinutes: String(branch.graceMinutes),
  lateDeduction: branch.lateDeduction,
  latePenalty: String(branch.latePenalty),
  paidHours: String(Math.round((branch.paidMinutesPerDay / 60) * 100) / 100),
  afternoonDayCredit: branch.afternoonDayCredit === 1 ? '1' : '0.5',
  ownerClocksIn: branch.ownerClocksIn ? 'yes' : 'no',
});

/**
 * Settings > Attendance (ATT-07): shift clock-in times, grace, the late deduction, the
 * afternoon-only day and whether the Owner clocks in. A change applies from the next clock-in;
 * every record keeps the rules it was made with (ATT-09).
 */
export function AttendanceSettingsPage() {
  const { branch, loading, error } = useBranch();

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <PageHeader title="Attendance" backTo="/settings" backLabel="Back to settings" />
      {error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the attendance settings.</b> Check your connection and reload.
        </Alert>
      ) : loading || !branch ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : (
        <AttendanceForm branch={branch} />
      )}
    </div>
  );
}

function AttendanceForm({ branch }: { branch: BranchSettings }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AttendanceValues>({
    resolver: zodResolver(attendanceSchema),
    defaultValues: valuesFrom(branch),
  });

  // Keep the form in step with changes saved elsewhere, unless the Owner is editing it.
  useEffect(() => {
    if (!isDirty) reset(valuesFrom(branch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const lateDeduction = useWatch({ control, name: 'lateDeduction' });
  const paidHours = Number(useWatch({ control, name: 'paidHours' }));
  const latePenalty = Number(useWatch({ control, name: 'latePenalty' }));

  const example =
    lateDeduction === 'none'
      ? 'Lateness is recorded, and nothing is deducted.'
      : lateDeduction === 'minutes'
        ? paidHours >= 1
          ? `Example: with a ${peso(EXAMPLE_RATE)} daily rate, ${EXAMPLE_MINUTES} minutes late deducts ${peso((EXAMPLE_RATE / (paidHours * 60)) * EXAMPLE_MINUTES)}.`
          : null
        : Number.isFinite(latePenalty)
          ? `Each late day deducts ${peso(latePenalty)}, however few minutes late.`
          : null;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSaved(false);
    try {
      await updateBranchSettings({
        morning_clock_in: values.morningClockIn,
        afternoon_clock_in: values.afternoonClockIn,
        grace_minutes: Number(values.graceMinutes),
        late_deduction: values.lateDeduction,
        late_penalty: Number(values.latePenalty),
        paid_minutes_per_day: Math.round(Number(values.paidHours) * 60),
        afternoon_day_credit: values.afternoonDayCredit === '1' ? 1 : 0.5,
        owner_clocks_in: values.ownerClocksIn === 'yes',
      });
      reset(values);
      setSaved(true);
    } catch (caught) {
      setError(describeSaveError(caught));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[14px]">
      {error && <Alert variant="danger">{error}</Alert>}

      <section className={sectionClass} aria-labelledby="shifts-heading">
        <h2 id="shifts-heading" className={headingClass}>
          Shifts
        </h2>
        <div className="grid gap-[14px] sm:grid-cols-2">
          <Field
            id="att-morning"
            label="Morning shift clock-in"
            hint="Manila time."
            error={errors.morningClockIn?.message}
          >
            <Input
              id="att-morning"
              type="time"
              step={60}
              className={inputClass}
              aria-invalid={!!errors.morningClockIn || undefined}
              aria-describedby={describedBy('att-morning', errors.morningClockIn)}
              {...register('morningClockIn')}
            />
          </Field>
          <Field
            id="att-afternoon"
            label="Afternoon shift clock-in"
            hint="Manila time."
            error={errors.afternoonClockIn?.message}
          >
            <Input
              id="att-afternoon"
              type="time"
              step={60}
              className={inputClass}
              aria-invalid={!!errors.afternoonClockIn || undefined}
              aria-describedby={describedBy('att-afternoon', errors.afternoonClockIn)}
              {...register('afternoonClockIn')}
            />
          </Field>
        </div>
        <Field
          id="att-grace"
          label="Grace period (minutes)"
          hint="A clock-in up to this long after the shift time is on time. After that it is late, and the minutes late count from the shift time."
          error={errors.graceMinutes?.message}
        >
          <Input
            id="att-grace"
            inputMode="numeric"
            autoComplete="off"
            className={`${inputClass} max-w-[140px]`}
            aria-invalid={!!errors.graceMinutes || undefined}
            aria-describedby={describedBy('att-grace', errors.graceMinutes)}
            {...register('graceMinutes')}
          />
        </Field>
      </section>

      <section className={sectionClass} aria-labelledby="late-heading">
        <h2 id="late-heading" className={headingClass}>
          Late deduction
        </h2>
        <Controller
          control={control}
          name="lateDeduction"
          render={({ field }) => (
            <Segmented
              label="Late deduction"
              options={LATE_DEDUCTION_OPTIONS}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        {lateDeduction === 'minutes' && (
          <Field
            id="att-hours"
            label="Paid hours per day"
            hint="Each minute late deducts the daily rate divided by these minutes."
            error={errors.paidHours?.message}
          >
            <Input
              id="att-hours"
              inputMode="decimal"
              autoComplete="off"
              className={`${inputClass} max-w-[140px]`}
              aria-invalid={!!errors.paidHours || undefined}
              aria-describedby={describedBy('att-hours', errors.paidHours)}
              {...register('paidHours')}
            />
          </Field>
        )}
        {lateDeduction === 'flat' && (
          <>
            <Field
              id="att-penalty"
              label="Amount per late day (₱)"
              hint="Deducted once for each late day."
              error={errors.latePenalty?.message}
            >
              <Input
                id="att-penalty"
                inputMode="decimal"
                autoComplete="off"
                className={`${inputClass} max-w-[160px]`}
                aria-invalid={!!errors.latePenalty || undefined}
                aria-describedby={describedBy('att-penalty', errors.latePenalty)}
                {...register('latePenalty')}
              />
            </Field>
            <Alert variant="warn">
              <span>
                <b>Check before using a flat amount.</b> Philippine rules limit deductions from
                wages, and a fine larger than the pay for the time actually missed may not be
                allowed. Ask your accountant or DOLE. Deducting only the minutes late is generally
                safe.
              </span>
            </Alert>
          </>
        )}
        {example && (
          <p className="text-[13.5px] text-neutral-800" aria-live="polite">
            {example}
          </p>
        )}
      </section>

      <section className={sectionClass} aria-labelledby="pay-heading">
        <h2 id="pay-heading" className={headingClass}>
          Day credit and who clocks in
        </h2>
        <div>
          <Label className="text-[13px]">
            A day that starts with the afternoon shift counts as
          </Label>
          <Controller
            control={control}
            name="afternoonDayCredit"
            render={({ field }) => (
              <Segmented
                label="A day that starts with the afternoon shift counts as"
                options={[
                  { value: '0.5', label: 'Half day' },
                  { value: '1', label: 'Full day' },
                ]}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
        <div>
          <Label className="text-[13px]">The Owner clocks in too</Label>
          <Controller
            control={control}
            name="ownerClocksIn"
            render={({ field }) => (
              <Segmented
                label="The Owner clocks in too"
                options={[
                  { value: 'no', label: 'No, staff only' },
                  { value: 'yes', label: 'Yes' },
                ]}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      </section>

      <p className="text-[13px] text-neutral-700">
        Changes apply from the next clock-in. Past attendance and pay never change.
      </p>
      <div className="flex flex-wrap items-center gap-[12px]">
        <Button
          type="submit"
          className="min-h-[46px] px-[22px]"
          disabled={isSubmitting || !isDirty}
        >
          {isSubmitting ? 'Saving…' : 'Save attendance rules'}
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
