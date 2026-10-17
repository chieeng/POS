import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { passwordLinkFailed, passwordLinkToken } from '@/lib/supabase';
import { ICON_STROKE } from '@/lib/utils';
import { SplashScreen } from '@/routes/ProtectedLayout';
import { useSession } from '@/stores/session';
import { AuthLayout } from './AuthLayout';
import { describeAuthError, errorCodeOf, type AuthErrorMessage } from './authErrors';
import {
  pendingSecondStep,
  redeemPasswordLink,
  setNewPassword,
  signOutUser,
  type TotpChallenge,
} from './authService';
import { checkPwnedPassword } from './pwnedPasswords';
import { newPasswordSchema, PASSWORD_MIN_LENGTH, type NewPasswordValues } from './schemas';
import { TotpStep } from './TotpStep';

function describePasswordError(error: unknown): AuthErrorMessage {
  const code = errorCodeOf(error);
  if (code === 'weak_password') {
    return {
      kind: 'unknown',
      title: 'That password is too easy to guess.',
      detail: `Use at least ${PASSWORD_MIN_LENGTH} characters, and not one you use elsewhere.`,
    };
  }
  if (code === 'same_password') {
    return {
      kind: 'unknown',
      title: 'That is your old password.',
      detail: 'Choose a different one.',
    };
  }
  return describeAuthError(error);
}

const BREACHED: AuthErrorMessage = {
  kind: 'unknown',
  title: 'This password has appeared in a data breach.',
  detail: 'Choose another.',
};

/**
 * Where a one-time password link lands (AUTH-02). A new user chooses their first password
 * here; so does anyone the Owner made a reset link for. The Owner never sets or sees it.
 *
 * Opening the link only shows a Continue button: the link is used when that is pressed, so a
 * link preview, an email scanner or a second tab cannot use it up first.
 */
export function SetPasswordPage() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const passwordSetup = useSession((s) => s.passwordSetup);
  const notice = useSession((s) => s.notice);

  // waiting: Continue not pressed yet. used: pressed and accepted, signing in. failed: refused.
  const [link, setLink] = useState<'none' | 'waiting' | 'using' | 'used' | 'failed'>(
    passwordLinkToken ? 'waiting' : 'none',
  );
  const [challenge, setChallenge] = useState<TotpChallenge | null | 'checking'>('checking');
  const [error, setError] = useState<AuthErrorMessage | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '' },
  });

  // An account with an authenticator app must pass it before its password can change.
  const uid = user?.uid;
  const secondFactor = user?.secondFactor;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    pendingSecondStep().then(
      (pending) => {
        if (!cancelled) setChallenge(pending);
      },
      () => {
        if (!cancelled) setChallenge(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uid, secondFactor]);

  if (status === 'loading') return <SplashScreen />;

  const continueWithLink = async () => {
    if (!passwordLinkToken) return;
    setLink('using');
    try {
      await redeemPasswordLink(passwordLinkToken);
      setLink('used');
    } catch {
      setLink('failed');
    }
  };

  if (link === 'waiting' || link === 'using') {
    return (
      <AuthLayout>
        <div className="flex flex-1 flex-col gap-[16px]">
          <div className="mt-[24px] grid size-[84px] place-items-center rounded-full bg-accent-2-100 text-accent-2-800 md:mt-0">
            <KeyRound size={38} strokeWidth={ICON_STROKE} aria-hidden />
          </div>
          <h1 className="text-[32px] leading-[1.1]">Set your password</h1>
          <p className="text-[15px] leading-[1.5] text-neutral-800">
            This one-time link lets you choose the password for your POS account. It works only
            once, so continue when you are ready to choose it.
          </p>
          <div className="flex-1 md:hidden" />
          <Button size="lg" onClick={continueWithLink} disabled={link === 'using'}>
            {link === 'using' ? 'Checking the link…' : 'Continue'}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // Accepted: wait for the sign-in to arrive, unless it was refused (the notice says why).
  if (link === 'used' && !user && !notice) return <SplashScreen />;

  if (status === 'signedOut' || !user) {
    if (link !== 'failed' && !passwordLinkFailed) return <Navigate to="/sign-in" replace />;
    return (
      <AuthLayout>
        <div className="flex flex-1 flex-col gap-[16px]">
          <h1 className="mt-[24px] text-[32px] leading-[1.1] md:mt-0">This link no longer works</h1>
          <Alert variant="danger">
            <b>The link has expired or was already used.</b> Ask the Owner to make a new one.
          </Alert>
          <div className="flex-1 md:hidden" />
          <Button size="lg" asChild>
            <a href="/sign-in">Go to sign in</a>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (!passwordSetup) return <Navigate to="/" replace />;
  if (challenge === 'checking') return <SplashScreen />;
  if (challenge) return <TotpStep challenge={challenge} onBack={() => void signOutUser()} />;

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    // SEC-05: refuse a password known from a data breach. If the check cannot run, the
    // password is accepted; the 10-character minimum still applies.
    if ((await checkPwnedPassword(password)) === 'breached') {
      setError(BREACHED);
      return;
    }
    try {
      await setNewPassword(password);
    } catch (caught) {
      setError(describePasswordError(caught));
    }
  });

  const PasswordIcon = showPassword ? EyeOff : Eye;

  return (
    <AuthLayout>
      <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-[16px]">
        <div className="mt-[24px] grid size-[84px] place-items-center rounded-full bg-accent-2-100 text-accent-2-800 md:mt-0">
          <KeyRound size={38} strokeWidth={ICON_STROKE} aria-hidden />
        </div>
        <h1 className="text-[32px] leading-[1.1]">Choose your password</h1>
        <p className="text-[15px] leading-[1.5] text-neutral-800">
          This is for <b>{user.email}</b>. Only you should know it; the Owner never sees it.
        </p>

        {error && (
          <Alert variant="danger">
            <b>{error.title}</b> {error.detail}
          </Alert>
        )}

        <div>
          <Label htmlFor="new-password" className="text-[13px]">
            New password
          </Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              className="min-h-[52px] pr-[52px] text-[16px]"
              aria-invalid={!!errors.password || undefined}
              aria-describedby={errors.password ? 'new-password-error' : 'new-password-hint'}
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
          {errors.password ? (
            <p id="new-password-error" className="mt-[5px] text-[13px] text-danger-fg">
              {errors.password.message}
            </p>
          ) : (
            <p id="new-password-hint" className="mt-[5px] text-[13px] text-neutral-700">
              At least {PASSWORD_MIN_LENGTH} characters.
            </p>
          )}
        </div>

        <div className="flex-1 md:hidden" />
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save password'}
        </Button>
        <Button variant="quiet" size="touch" className="self-center" onClick={() => signOutUser()}>
          Sign out
        </Button>
      </form>
    </AuthLayout>
  );
}
