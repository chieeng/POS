export type AuthErrorKind =
  | 'wrong-credentials'
  | 'disabled'
  | 'no-access'
  | 'too-many-attempts'
  | 'offline'
  | 'wrong-code'
  | 'recent-sign-in-needed'
  | 'unknown';

export interface AuthErrorMessage {
  kind: AuthErrorKind;
  title: string;
  detail: string;
}

const MESSAGES: Record<AuthErrorKind, Omit<AuthErrorMessage, 'kind'>> = {
  'wrong-credentials': {
    title: 'Email or password is wrong.',
    detail: 'Check both and try again.',
  },
  disabled: {
    title: 'This account is turned off.',
    detail: 'Ask the Owner to turn it back on.',
  },
  'no-access': {
    title: 'This account has no access to POS.',
    detail: 'Ask the Owner to check your account.',
  },
  'too-many-attempts': {
    title: 'Too many tries.',
    detail: 'This account is locked for a while. Wait a few minutes, then try again.',
  },
  offline: {
    title: 'No internet connection.',
    detail: 'Connect to the internet, then try again.',
  },
  'wrong-code': {
    title: 'That code is wrong.',
    detail: 'Enter the current 6-digit code from your authenticator app.',
  },
  'recent-sign-in-needed': {
    title: 'Please sign in again.',
    detail: 'For your security this step needs a fresh sign-in.',
  },
  unknown: {
    title: 'Something went wrong.',
    detail: 'Try again. If it keeps happening, tell the Owner.',
  },
};

/** Codes this app raises itself, next to the ones Supabase Auth returns. */
export const APP_ERROR = {
  noSession: 'no_session',
  captchaUnavailable: 'captcha_unavailable',
} as const;

const CODE_TO_KIND: Record<string, AuthErrorKind> = {
  // Supabase Auth reports a wrong email and a wrong password the same way; the message
  // must not tell them apart either (no account enumeration).
  invalid_credentials: 'wrong-credentials',
  validation_failed: 'wrong-credentials',
  user_not_found: 'wrong-credentials',
  user_banned: 'disabled',
  over_request_rate_limit: 'too-many-attempts',
  mfa_verification_failed: 'wrong-code',
  mfa_challenge_expired: 'wrong-code',
  mfa_verification_rejected: 'wrong-code',
  session_not_found: 'recent-sign-in-needed',
  session_expired: 'recent-sign-in-needed',
  refresh_token_not_found: 'recent-sign-in-needed',
  reauthentication_needed: 'recent-sign-in-needed',
  insufficient_aal: 'recent-sign-in-needed',
  [APP_ERROR.noSession]: 'recent-sign-in-needed',
  // The CAPTCHA script could not be reached: in practice, no connection.
  [APP_ERROR.captchaUnavailable]: 'offline',
};

export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** The request never reached Supabase: the device is offline or the network dropped it. */
export function isNetworkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, status, message } = error as {
    name?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (name === 'AuthRetryableFetchError' || status === 0) return true;
  return typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message);
}

function tooManyRequests(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 429
  );
}

export function describeAuthError(error: unknown): AuthErrorMessage {
  const code = errorCodeOf(error);
  const kind: AuthErrorKind =
    (code && CODE_TO_KIND[code]) ||
    (tooManyRequests(error) ? 'too-many-attempts' : isNetworkError(error) ? 'offline' : 'unknown');
  return { kind, ...MESSAGES[kind] };
}
