export type AuthErrorKind =
  | 'wrong-credentials'
  | 'disabled'
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
    title: "Couldn't sign in.",
    detail: 'Try again. If it keeps happening, tell the Owner.',
  },
};

const CODE_TO_KIND: Record<string, AuthErrorKind> = {
  // With email enumeration protection on (SEC-05), Firebase reports a wrong email and a
  // wrong password the same way; the message must not tell them apart either.
  'auth/invalid-credential': 'wrong-credentials',
  'auth/invalid-login-credentials': 'wrong-credentials',
  'auth/wrong-password': 'wrong-credentials',
  'auth/user-not-found': 'wrong-credentials',
  'auth/invalid-email': 'wrong-credentials',
  'auth/user-disabled': 'disabled',
  'auth/too-many-requests': 'too-many-attempts',
  'auth/network-request-failed': 'offline',
  'auth/invalid-verification-code': 'wrong-code',
  'auth/code-expired': 'wrong-code',
  'auth/requires-recent-login': 'recent-sign-in-needed',
  'auth/user-token-expired': 'recent-sign-in-needed',
};

export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function describeAuthError(error: unknown): AuthErrorMessage {
  const code = errorCodeOf(error);
  const kind = (code && CODE_TO_KIND[code]) || 'unknown';
  return { kind, ...MESSAGES[kind] };
}
