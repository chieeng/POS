import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ICON_STROKE } from '@/lib/utils';
import { AuthLayout } from './AuthLayout';
import { describeAuthError, type AuthErrorMessage } from './authErrors';
import { verifyTotp, type TotpChallenge } from './authService';
import { CodeInput } from './CodeInput';
import { totpCodeSchema, type TotpCodeValues } from './schemas';

interface TotpStepProps {
  challenge: TotpChallenge;
  onBack: () => void;
}

/** The Owner's second step (SEC-05): a 6-digit code from an authenticator app. */
export function TotpStep({ challenge, onBack }: TotpStepProps) {
  const [error, setError] = useState<AuthErrorMessage | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpCodeValues>({
    resolver: zodResolver(totpCodeSchema),
    defaultValues: { code: '' },
  });

  const onSubmit = handleSubmit(async ({ code }) => {
    setError(null);
    try {
      await verifyTotp(challenge, code);
    } catch (caught) {
      setError(describeAuthError(caught));
    }
  });

  return (
    <AuthLayout>
      <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-[16px]">
        <Button variant="secondary" size="icon" onClick={onBack} aria-label="Back to sign in">
          <ArrowLeft size={18} strokeWidth={ICON_STROKE} aria-hidden />
        </Button>
        <div className="mt-[40px] grid size-[84px] place-items-center rounded-full bg-accent-2-100 text-accent-2-800 md:mt-[8px]">
          <ShieldCheck size={38} strokeWidth={ICON_STROKE} aria-hidden />
        </div>
        <h1 className="text-[32px] leading-[1.1]">Enter your code</h1>
        <p className="text-[15px] leading-[1.5] text-neutral-800">
          Open your authenticator app and enter the 6-digit code for <b>POS</b>. The code changes
          every 30 seconds.
        </p>

        {error && (
          <Alert variant="danger">
            <b>{error.title}</b> {error.detail}
          </Alert>
        )}

        <Controller
          control={control}
          name="code"
          render={({ field }) => (
            <CodeInput
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              autoFocus
              aria-label="6-digit code"
              aria-describedby={errors.code ? 'code-error' : undefined}
              invalid={!!errors.code || error?.kind === 'wrong-code'}
              className="mt-[6px]"
            />
          )}
        />
        {errors.code && (
          <p id="code-error" className="text-[13px] text-danger-fg">
            {errors.code.message}
          </p>
        )}

        <div className="flex-1 md:hidden" />
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? 'Checking…' : 'Verify'}
        </Button>
      </form>
    </AuthLayout>
  );
}
