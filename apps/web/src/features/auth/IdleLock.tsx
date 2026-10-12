import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SessionUser } from '@/stores/session';
import { describeAuthError, type AuthErrorMessage } from './authErrors';
import { confirmPassword, signOutUser } from './authService';
import { initialsOf, ROLE_LABELS } from './roles';
import { unlockSchema, type UnlockValues } from './schemas';
import { unlockIdle } from './useIdleLock';
import { useTurnstile } from './useTurnstile';

interface IdleLockProps {
  user: SessionUser;
  minutes: number;
}

/**
 * AUTH-05 lock screen, shown over the blurred app. Work in progress stays mounted behind it.
 * Full screen on phones, a centered card from tablet width up.
 */
export function IdleLock({ user, minutes }: IdleLockProps) {
  const [error, setError] = useState<AuthErrorMessage | null>(null);
  const { containerRef, getToken } = useTurnstile();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UnlockValues>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await confirmPassword(password, await getToken());
      unlockIdle();
    } catch (caught) {
      const described = describeAuthError(caught);
      if (described.kind === 'wrong-credentials') {
        setError({ ...described, title: 'That password is wrong.', detail: 'Try again.' });
      } else if (described.kind === 'disabled' || described.kind === 'recent-sign-in-needed') {
        await signOutUser();
      } else {
        setError(described);
      }
    }
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-50 grid bg-surface md:place-items-center md:bg-bg/30 md:p-[24px]"
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex w-full flex-col items-center gap-[14px] px-[28px] pt-[56px] pb-[28px] md:w-[440px] md:items-start md:rounded-[40px] md:bg-bg md:p-[36px] md:shadow-lg"
      >
        <div
          aria-hidden
          className="grid size-[72px] place-items-center rounded-full bg-accent-2-300 text-[24px] font-bold text-accent-2-900"
        >
          {initialsOf(user.displayName)}
        </div>
        <h1 id="lock-title" className="text-center text-[30px] leading-[1.1] md:text-left">
          Locked after {minutes} {minutes === 1 ? 'minute' : 'minutes'} idle
        </h1>
        <div className="text-[14.5px] text-neutral-800">
          {user.displayName} · {ROLE_LABELS[user.role]}
        </div>

        {error && (
          <Alert variant="danger" className="w-full">
            <b>{error.title}</b> {error.detail}
          </Alert>
        )}

        <div className="w-full">
          <Label htmlFor="unlock-password" className="text-[13px]">
            Password
          </Label>
          <Input
            id="unlock-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            className="min-h-[52px] text-[16px]"
            aria-invalid={!!errors.password || error?.kind === 'wrong-credentials' || undefined}
            aria-describedby={errors.password ? 'unlock-error' : undefined}
            {...register('password')}
          />
          {errors.password && (
            <p id="unlock-error" className="mt-[5px] text-[13px] text-danger-fg">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* SEC-06: Turnstile. Empty unless Cloudflare asks for a challenge. */}
        <div ref={containerRef} className="empty:hidden" />

        <Button
          type="submit"
          size="lg"
          className="min-h-[54px] justify-between px-[22px] text-[18px]"
          disabled={isSubmitting}
        >
          <span>{isSubmitting ? 'Unlocking…' : 'Unlock'}</span>
          <kbd className="hidden rounded-[8px] bg-bg/22 px-[8px] py-[3px] font-body text-[12px] font-semibold md:inline">
            Enter
          </kbd>
        </Button>
        <div className="flex-1 md:hidden" />
        <Button variant="quiet" size="touch" onClick={() => signOutUser()}>
          Sign in as someone else
        </Button>
      </form>
    </div>
  );
}
