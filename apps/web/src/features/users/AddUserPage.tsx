import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { initialsOf } from '@/features/auth/roles';
import { PageHeader } from '@/features/settings/PageHeader';
import { api, describeApiError } from '@/lib/api';
import { ResetLinkPanel } from './ResetLinkPanel';
import { addUserSchema, STAFF_ROLE_OPTIONS, type AddUserValues } from './schemas';

/** Settings > Users > Add user (AUTH-02, SEC-01): the only way an account is created. */
export function AddUserPage() {
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; link: string } | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<AddUserValues>({
    resolver: zodResolver(addUserSchema),
    defaultValues: { displayName: '', email: '', role: 'sales', userCode: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await api.createUser(values);
      setCreated({ name: values.displayName, link: result.resetLink });
    } catch (caught) {
      setError(describeApiError(caught));
    }
  });

  // Suggest the initials as the user code until the Owner types their own.
  const suggestCode = () => {
    if (dirtyFields.userCode) return;
    const initials = initialsOf(getValues('displayName'));
    if (initials.length >= 2) setValue('userCode', initials, { shouldValidate: false });
  };

  const fieldError = (message?: string, id?: string) =>
    message && (
      <p id={id} className="mt-[5px] text-[13px] text-danger-fg">
        {message}
      </p>
    );

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-[16px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <PageHeader
        title={created ? 'User added' : 'Add user'}
        backTo="/settings/users"
        backLabel="Back to users"
        alwaysBack
      />

      {created ? (
        <div className="flex flex-col gap-[16px] rounded-card bg-surface p-[20px]">
          <ResetLinkPanel link={created.link} name={created.name} />
          <Button asChild size="lg" className="min-h-[50px] text-[16px]">
            <Link to="/settings/users">Done</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[14px]">
          {error && <Alert variant="danger">{error}</Alert>}

          <div>
            <Label htmlFor="displayName" className="text-[13px]">
              Full name
            </Label>
            <Input
              id="displayName"
              autoComplete="off"
              className="min-h-[48px] text-[15px]"
              aria-invalid={!!errors.displayName || undefined}
              {...register('displayName', { onBlur: suggestCode })}
            />
            {fieldError(errors.displayName?.message)}
          </div>

          <div>
            <Label htmlFor="email" className="text-[13px]">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="min-h-[48px] text-[15px]"
              aria-invalid={!!errors.email || undefined}
              {...register('email')}
            />
            {fieldError(errors.email?.message)}
          </div>

          <div>
            <Label className="text-[13px]">Role</Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Segmented
                  label="Role"
                  options={STAFF_ROLE_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          <div>
            <Label htmlFor="userCode" className="text-[13px]">
              User code
            </Label>
            <Input
              id="userCode"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={6}
              className="min-h-[48px] text-[15px] font-semibold uppercase"
              aria-invalid={!!errors.userCode || undefined}
              aria-describedby="userCode-hint"
              {...register('userCode')}
            />
            <p id="userCode-hint" className="mt-[5px] text-[12.5px] text-neutral-700">
              2 to 6 letters or digits. It starts this person&apos;s receipt numbers.
            </p>
            {fieldError(errors.userCode?.message)}
          </div>

          <p className="text-[13px] text-neutral-700">
            No password is set here. You&apos;ll get a one-time link to send them so they choose
            their own.
          </p>

          <div className="flex justify-end gap-[10px]">
            <Button asChild variant="secondary" className="min-h-[48px] px-[20px]">
              <Link to="/settings/users">Cancel</Link>
            </Button>
            <Button type="submit" className="min-h-[48px] px-[28px]" disabled={isSubmitting}>
              {isSubmitting ? 'Adding…' : 'Add user'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
