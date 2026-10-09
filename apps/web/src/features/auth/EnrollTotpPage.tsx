import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ICON_STROKE } from '@/lib/utils';
import { AuthLayout } from './AuthLayout';
import { describeAuthError, type AuthErrorMessage } from './authErrors';
import {
  finishTotpEnrollment,
  signOutUser,
  startTotpEnrollment,
  type TotpEnrollment,
} from './authService';
import { CodeInput } from './CodeInput';
import { totpCodeSchema, type TotpCodeValues } from './schemas';

/**
 * SEC-05: the Owner must turn on two-step sign-in before using the app. Shown to an Owner
 * whose sign-in had no authenticator step. Rules and functions refuse Owner access without
 * it, so skipping this screen gains nothing.
 */
export function EnrollTotpPage() {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [error, setError] = useState<AuthErrorMessage | null>(null);
  const [copied, setCopied] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpCodeValues>({
    resolver: zodResolver(totpCodeSchema),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    let cancelled = false;
    startTotpEnrollment()
      .then((started) => {
        if (!cancelled) setEnrollment(started);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeAuthError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = handleSubmit(async ({ code }) => {
    if (!enrollment) return;
    setError(null);
    try {
      await finishTotpEnrollment(enrollment, code);
      // The current session was made without the second step; start a fresh one that has it.
      await signOutUser('two-step-ready');
    } catch (caught) {
      setError(describeAuthError(caught));
    }
  });

  const copyKey = async () => {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secretKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AuthLayout>
      <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-[16px]">
        <div className="mt-[24px] grid size-[84px] place-items-center rounded-full bg-accent-2-100 text-accent-2-800 md:mt-0">
          <ShieldCheck size={38} strokeWidth={ICON_STROKE} aria-hidden />
        </div>
        <h1 className="text-[32px] leading-[1.1]">Turn on two-step sign-in</h1>
        <p className="text-[15px] leading-[1.5] text-neutral-800">
          The Owner account needs a code from an authenticator app (such as Google Authenticator) at
          every sign-in.
        </p>

        {error && (
          <Alert variant="danger">
            <b>{error.title}</b> {error.detail}
          </Alert>
        )}

        {enrollment && (
          <>
            <div className="flex flex-col gap-[8px] rounded-card bg-surface p-[20px]">
              <div className="text-[13px] text-text/70">
                1. Add an account in your authenticator app with this setup key
              </div>
              <div className="font-mono text-[16px] font-semibold break-all select-all">
                {enrollment.secretKey}
              </div>
              <div className="flex flex-wrap gap-x-[16px]">
                <Button variant="quiet" size="touch" onClick={copyKey}>
                  <Copy size={16} strokeWidth={ICON_STROKE} aria-hidden />
                  {copied ? 'Copied' : 'Copy key'}
                </Button>
                <Button variant="quiet" size="touch" asChild>
                  <a href={enrollment.otpauthUrl}>Open authenticator app on this device</a>
                </Button>
              </div>
            </div>

            <div className="text-[13px] text-text/70">2. Enter the 6-digit code it shows</div>
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
                  aria-label="6-digit code"
                  aria-describedby={errors.code ? 'code-error' : undefined}
                  invalid={!!errors.code || error?.kind === 'wrong-code'}
                />
              )}
            />
            {errors.code && (
              <p id="code-error" className="text-[13px] text-danger-fg">
                {errors.code.message}
              </p>
            )}
          </>
        )}

        <div className="flex-1 md:hidden" />
        <Button type="submit" size="lg" disabled={!enrollment || isSubmitting}>
          {isSubmitting ? 'Checking…' : 'Turn on'}
        </Button>
        <Button variant="quiet" size="touch" className="self-center" onClick={() => signOutUser()}>
          Sign out
        </Button>
      </form>
    </AuthLayout>
  );
}
