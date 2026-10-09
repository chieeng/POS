import {
  EmailAuthProvider,
  getMultiFactorResolver,
  multiFactor,
  onIdTokenChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from 'firebase/auth';
import { auth, env } from '@/lib/firebase';
import { useSession, type SessionUser, type SignInNotice } from '@/stores/session';
import { errorCodeOf } from './authErrors';
import { clearIdleState } from './idleStorage';
import { parseAccessClaims } from './roles';

/** The Owner's pending second step: Firebase's resolver plus the enrolled TOTP factor id. */
export interface TotpChallenge {
  resolver: MultiFactorResolver;
  factorUid: string;
}

export type SignInResult =
  { kind: 'signedIn' } | { kind: 'totpRequired'; challenge: TotpChallenge };

/** AUTH-01: email and password. Returns the TOTP challenge when the account has 2-step on. */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    clearIdleState();
    return { kind: 'signedIn' };
  } catch (error) {
    if (errorCodeOf(error) !== 'auth/multi-factor-auth-required') throw error;
    const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
    const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!hint) {
      throw new Error('This account uses a second step this app does not support.', {
        cause: error,
      });
    }
    return { kind: 'totpRequired', challenge: { resolver, factorUid: hint.uid } };
  }
}

export async function verifyTotp(challenge: TotpChallenge, code: string): Promise<void> {
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(challenge.factorUid, code);
  await challenge.resolver.resolveSignIn(assertion);
  clearIdleState();
}

export async function signOutUser(notice: SignInNotice = null): Promise<void> {
  useSession.getState().setNotice(notice);
  clearIdleState();
  clearCachedSession();
  await signOut(auth);
}

/**
 * AUTH-05: confirm the password to resume after the idle lock. For an account with 2-step
 * sign-in, Firebase answers a correct password with "multi-factor-auth-required"; that is
 * only sent after the password has been verified, so it counts as a successful unlock.
 */
export async function confirmPassword(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email)
    throw Object.assign(new Error('Not signed in'), { code: 'auth/user-token-expired' });
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  } catch (error) {
    if (errorCodeOf(error) === 'auth/multi-factor-auth-required') return;
    throw error;
  }
}

export interface TotpEnrollment {
  secret: TotpSecret;
  secretKey: string;
  /** otpauth:// link that opens an authenticator app on the same device. */
  otpauthUrl: string;
}

/** SEC-05: start enrolling the Owner's authenticator app. */
export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Not signed in'), { code: 'auth/user-token-expired' });
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  return {
    secret,
    secretKey: secret.secretKey,
    otpauthUrl: secret.generateQrCodeUrl(user.email ?? 'owner', 'POS'),
  };
}

export async function finishTotpEnrollment(
  enrollment: TotpEnrollment,
  code: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Not signed in'), { code: 'auth/user-token-expired' });
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(enrollment.secret, code);
  await multiFactor(user).enroll(assertion, 'Authenticator app');
}

// The last verified session, kept so the app can open offline (NFR-02) when the ID token
// cannot be refreshed. It holds nothing beyond the user's own role (NFR-04) and grants
// nothing: every read and write is still checked by Security Rules when it syncs.
const SESSION_CACHE_KEY = 'pos.session';

function cacheSession(user: SessionUser) {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable: offline start-up just will not work.
  }
}

function readCachedSession(uid: string): SessionUser | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as SessionUser;
    return cached.uid === uid ? cached : null;
  } catch {
    return null;
  }
}

function clearCachedSession() {
  try {
    localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}

async function resolveSession(user: User): Promise<SessionUser | null> {
  try {
    const token = await user.getIdTokenResult();
    const access = parseAccessClaims(token.claims);
    if (!access) return null;
    // The Auth emulator cannot do TOTP; local development treats the step as passed.
    // Removed from production bundles (build-time constant).
    if (import.meta.env.DEV && env.useEmulators) access.secondFactor = true;
    return {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName || user.email || 'User',
      ...access,
    };
  } catch (error) {
    if (errorCodeOf(error) === 'auth/network-request-failed') return readCachedSession(user.uid);
    throw error;
  }
}

/**
 * Keeps the session store in step with Firebase Auth. Anyone without a valid role, or with
 * active false, is signed out straight away (SEC-02). Revoked or disabled accounts
 * (SEC-04, AUTH-04) arrive here as a null user when their token refresh is refused.
 */
export function startAuthListener(): () => void {
  return onIdTokenChanged(auth, (user) => {
    const session = useSession.getState();
    if (!user) {
      clearIdleState();
      session.setSignedOut();
      return;
    }
    resolveSession(user)
      .then((sessionUser) => {
        if (!sessionUser) return signOutUser('no-access');
        cacheSession(sessionUser);
        session.setSignedIn(sessionUser);
      })
      .catch(() => signOutUser());
  });
}
