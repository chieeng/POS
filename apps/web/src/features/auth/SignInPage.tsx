import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOnline } from '@/hooks/useOnline';
import { ICON_STROKE } from '@/lib/utils';
import { useSession, type SignInNotice } from '@/stores/session';
import { AuthLayout } from './AuthLayout';
import { describeAuthError, type AuthErrorMessage } from './authErrors';
import { cancelSecondStep, signIn, type TotpChallenge } from './authService';
import { ROLE_HOME } from './roles';
import { signInSchema, type SignInValues } from './schemas';
import { TotpStep } from './TotpStep';
import { useTurnstile } from './useTurnstile';

const NOTICES: Record<Exclude<SignInNotice, null>, { variant: 'danger' | 'warn'; text: string }> = {
  'no-access': {
    variant: 'danger',
    text: 'This account has no access to POS. Ask the Owner to check your account.',
  },
  'two-step-ready': {
    variant: 'warn',
    text: 'Two-step sign-in is on. Sign in again and enter the code from your authenticator app.',
  },
};

export function SignInPage() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const notice = useSession((s) => s.notice);
  const setNotice = useSession((s) => s.setNotice);
  const online = useOnline();
  const { containerRef, getToken } = useTurnstile();

  const [challenge, setChallenge] = useState<TotpChallenge | null>(null);
  const [error, setError] = useState<AuthErrorMessage | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  if (status === 'signedIn' && user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  if (challenge) {
    return (
      <TotpStep
        challenge={challenge}
        onBack={() => {
          void cancelSecondStep();
          setChallenge(null);
        }}
      />
    );
  }

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    setNotice(null);
    try {
      const result = await signIn(email, password, await getToken());
      if (result.kind === 'totpRequired') setChallenge(result.challenge);
    } catch (caught) {
      setError(describeAuthError(caught));
    }
  });

  const credentialsWrong = error?.kind === 'wrong-credentials';
  const PasswordIcon = showPassword ? EyeOff : Eye;

  return (
    <AuthLayout phoneBrand>
      <div className="flex-1 md:hidden" />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[14px] md:gap-[16px]">
        <h1 className="hidden text-[34px] md:block">Sign in</h1>

        {!online && (
          <Alert variant="offline">
            <b>You are offline.</b> Signing in needs an internet connection.
          </Alert>
        )}
        {error && (
          <Alert variant="danger">
            <b>{error.title}</b> {error.detail}
          </Alert>
        )}
        {!error && notice && (
          <Alert variant={NOTICES[notice].variant}>{NOTICES[notice].text}</Alert>
        )}

        <div>
          <Label htmlFor="email" className="text-[13px]">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="min-h-[52px] text-[16px]"
            aria-invalid={!!errors.email || undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email && (
            <p id="email-error" className="mt-[5px] text-[13px] text-danger-fg">
              {errors.email.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="password" className="text-[13px]">
            Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="min-h-[52px] pr-[52px] text-[16px]"
              aria-invalid={!!errors.password || credentialsWrong || undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute top-[4px] right-[4px] grid size-[44px] place-items-center rounded-full text-neutral-700 hover:bg-text/7"
            >
              <PasswordIcon size={19} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </div>
          {errors.password && (
            <p id="password-error" className="mt-[5px] text-[13px] text-danger-fg">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* SEC-06: Turnstile. Empty unless Cloudflare asks this visitor to solve a challenge. */}
        <div ref={containerRef} className="empty:hidden" />

        <Button
          needsInternet
          type="submit"
          size="lg"
          className="mt-[6px] md:mt-0"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-center text-[13.5px] text-neutral-700">
          Forgot your password? Ask the Owner to reset it.
        </p>
      </form>
    </AuthLayout>
  );
}
