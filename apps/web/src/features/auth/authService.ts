import type { AuthChangeEvent, RealtimeChannel, Session } from '@supabase/supabase-js';
import { getDeviceTag } from '@/lib/device';
import {
  AUTH_STORAGE_KEY,
  createThrowawayClient,
  openedFromPasswordLink,
  supabase,
} from '@/lib/supabase';
import { useSession, type SessionUser, type SignInNotice } from '@/stores/session';
import { APP_ERROR, isNetworkError } from './authErrors';
import { clearIdleState } from './idleStorage';
import { parseProfileAccess } from './roles';

/** The Owner's pending second step: the enrolled authenticator-app factor to challenge. */
export interface TotpChallenge {
  factorId: string;
}

export type SignInResult =
  { kind: 'signedIn' } | { kind: 'totpRequired'; challenge: TotpChallenge };

function noSession(): Error {
  return Object.assign(new Error('Not signed in'), { code: APP_ERROR.noSession });
}

// True from the moment a password is accepted until the second step is passed or given up.
// A session in that state is not a sign-in yet; the listener below leaves it alone.
let signingIn = false;

/** The second step this session still owes, or null if it owes none. */
export async function pendingSecondStep(): Promise<TotpChallenge | null> {
  const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level.error) throw level.error;
  if (level.data.nextLevel !== 'aal2' || level.data.currentLevel === 'aal2') return null;

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  const totp = factors.data.totp.find((factor) => factor.status === 'verified');
  if (!totp) throw new Error('This account uses a second step this app does not support.');
  return { factorId: totp.id };
}

type AccountEvent = 'auth.passwordSet' | 'auth.twoStepOn';

/**
 * SYS-03: the server logs the account events, then the sign-in, in that order. It refuses an
 * Owner's sign-in until the second step is passed. A logging failure must not block the user.
 */
function record(...events: AccountEvent[]) {
  const p_device_tag = getDeviceTag();
  void (async () => {
    for (const p_action of events) {
      await supabase.rpc('record_account_event', { p_action, p_device_tag }).then(
        () => undefined,
        () => undefined,
      );
    }
    await supabase.rpc('record_sign_in', { p_device_tag }).then(
      () => undefined,
      () => undefined,
    );
  })();
}

/**
 * AUTH-01: email and password, with the CAPTCHA token Supabase Auth checks (SEC-06).
 * Returns the TOTP challenge when the account has 2-step on.
 */
export async function signIn(
  email: string,
  password: string,
  captchaToken: string,
): Promise<SignInResult> {
  signingIn = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });
    if (error) throw error;

    const challenge = await pendingSecondStep();
    if (challenge) return { kind: 'totpRequired', challenge };
  } catch (error) {
    signingIn = false;
    // Never leave a half-made session behind.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    throw error;
  }
  signingIn = false;
  clearIdleState();
  record();
  return { kind: 'signedIn' };
}

export async function verifyTotp(challenge: TotpChallenge, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: challenge.factorId,
    code,
  });
  if (error) throw error;
  signingIn = false;
  clearIdleState();
  record();
}

/** "Back" on the code screen: the password-only session is dropped. */
export async function cancelSecondStep(): Promise<void> {
  signingIn = false;
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
}

/** Signs out this device only; the user's other devices stay signed in (AUTH-04). */
export async function signOutUser(notice: SignInNotice = null): Promise<void> {
  signingIn = false;
  useSession.getState().setNotice(notice);
  clearIdleState();
  clearCachedSession();
  stopWatchingProfile();
  const result = await supabase.auth
    .signOut({ scope: 'local' })
    .catch((error: unknown) => ({ error }));
  if (result.error) {
    // Offline or already signed out on the server: forget the session on this device anyway.
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Nothing to forget.
    }
  }
  useSession.getState().setSignedOut();
}

/**
 * AUTH-05: confirm the password to resume after the idle lock. Supabase has no "check this
 * password" call, so the password is tried on a throwaway client and that extra session is
 * ended at once. The signed-in session, and the Owner's second step on it, are untouched.
 */
export async function confirmPassword(password: string, captchaToken: string): Promise<void> {
  const email = useSession.getState().user?.email;
  if (!email) throw noSession();

  const checker = createThrowawayClient();
  const { error } = await checker.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });
  if (error) throw error;
  await checker.auth.signOut({ scope: 'local' }).catch(() => undefined);
}

export interface TotpEnrollment {
  factorId: string;
  secretKey: string;
  /** The same secret as a QR code: an SVG image as a data: URL, made by Supabase Auth. */
  qrCode: string;
  /** otpauth:// link that opens an authenticator app on the same device. */
  otpauthUrl: string;
}

let enrolling: Promise<TotpEnrollment> | undefined;

/** SEC-05: start enrolling the Owner's authenticator app. */
export function startTotpEnrollment(): Promise<TotpEnrollment> {
  // One enrolment at a time, even if the screen asks twice while it mounts.
  enrolling ??= (async () => {
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    // An earlier visit that was never finished leaves an unverified factor; clear it.
    for (const factor of factors.data.all) {
      if (factor.status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Authenticator app',
      issuer: 'POS',
    });
    if (error) throw error;
    return {
      factorId: data.id,
      secretKey: data.totp.secret,
      qrCode: data.totp.qr_code,
      otpauthUrl: data.totp.uri,
    };
  })().finally(() => {
    enrolling = undefined;
  });
  return enrolling;
}

export async function finishTotpEnrollment(
  enrollment: TotpEnrollment,
  code: string,
): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: enrollment.factorId,
    code,
  });
  if (error) throw error;
  record('auth.twoStepOn');
}

/**
 * AUTH-02: uses the one-time link's token, after the person pressed Continue. Signs them in
 * as the account the link was made for, so they can choose a password.
 */
export async function redeemPasswordLink(tokenHash: string): Promise<void> {
  // Set first: the sign-in this causes is a password set-up, not a normal sign-in.
  useSession.getState().setPasswordSetup(true);
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (error) {
    useSession.getState().setPasswordSetup(false);
    throw error;
  }
}

/** AUTH-02: the user chooses their own password after opening a one-time link. */
export async function setNewPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  useSession.getState().setPasswordSetup(false);
  clearIdleState();
  record('auth.passwordSet');
}

// The last verified session, kept so the app can open offline (NFR-02) when the token
// cannot be refreshed. It holds nothing beyond the user's own role (NFR-04) and grants
// nothing: every read and write is still checked by Row Level Security on the server.
const SESSION_CACHE_KEY = 'pos.session';

function cacheSession(user: SessionUser) {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable: offline start-up just will not work.
  }
}

function readCachedSession(uid?: string): SessionUser | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as SessionUser;
    return uid === undefined || cached.uid === uid ? cached : null;
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

interface Resolved {
  user: SessionUser;
  /** The account has an authenticator app, and this session has not passed it yet. */
  owesSecondStep: boolean;
}

/**
 * Loads who this session belongs to. Role, branch and active flag come from the user's own
 * `profiles` row, read now (AUTH-03); null means there is no active profile (SEC-02).
 */
async function resolveSession(session: Session): Promise<Resolved | null> {
  // Asks the server, so a session ended by "sign out everywhere" is noticed here (SEC-13).
  const checked = await supabase.auth.getUser();
  if (checked.error) throw checked.error;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, email, role, branch_id, active')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  const access = parseProfileAccess(profile);
  if (!profile || !access) return null;

  const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level.error) throw level.error;
  const secondFactor = level.data.currentLevel === 'aal2';
  const email = String(profile.email || session.user.email || '');
  return {
    user: {
      uid: session.user.id,
      email,
      displayName: String(profile.display_name || email || 'User'),
      ...access,
      secondFactor,
    },
    owesSecondStep: level.data.nextLevel === 'aal2' && !secondFactor,
  };
}

let profileChannel: RealtimeChannel | null = null;
let watchedUid: string | null = null;

function stopWatchingProfile() {
  if (profileChannel) void supabase.removeChannel(profileChannel);
  profileChannel = null;
  watchedUid = null;
}

/**
 * Realtime on the user's own profile row: a deactivation or role change by the Owner signs
 * this device out at once (SEC-04), without waiting for the next request to be refused.
 */
function watchProfile(uid: string) {
  if (watchedUid === uid) return;
  stopWatchingProfile();
  watchedUid = uid;
  profileChannel = supabase
    .channel(`profile:${uid}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
      (payload) => {
        const current = useSession.getState().user;
        if (!current || current.uid !== uid) return;
        const row = payload.new as Record<string, unknown>;
        const access = parseProfileAccess(row);
        if (!access) {
          void signOutUser('no-access');
        } else if (access.role !== current.role || access.branchId !== current.branchId) {
          void signOutUser();
        } else if (
          typeof row.display_name === 'string' &&
          row.display_name !== current.displayName
        ) {
          const renamed = { ...current, displayName: row.display_name };
          cacheSession(renamed);
          useSession.getState().setSignedIn(renamed);
        }
      },
    )
    .subscribe();
}

let latest = 0;

async function handleAuthChange(event: AuthChangeEvent, session: Session | null) {
  const run = ++latest;
  const store = useSession.getState();

  if (!session) {
    // Offline with an expired token: open from the last verified session (NFR-02).
    const cached = navigator.onLine ? null : readCachedSession();
    if (cached) {
      store.setSignedIn(cached);
      return;
    }
    stopWatchingProfile();
    clearIdleState();
    store.setSignedOut();
    return;
  }
  if (event === 'PASSWORD_RECOVERY') store.setPasswordSetup(true);

  try {
    const resolved = await resolveSession(session);
    if (run !== latest) return;
    if (!resolved) {
      await signOutUser('no-access');
      return;
    }
    if (resolved.owesSecondStep && !useSession.getState().passwordSetup) {
      // Between password and code: not signed in yet. The sign-in screen shows the code step.
      if (signingIn) {
        if (useSession.getState().status === 'loading') store.setSignedOut();
        return;
      }
      // A half-finished sign-in left over from an earlier visit.
      await signOutUser();
      return;
    }
    cacheSession(resolved.user);
    store.setSignedIn(resolved.user);
    watchProfile(resolved.user.uid);
  } catch (error) {
    if (run !== latest) return;
    const cached = isNetworkError(error) ? readCachedSession(session.user.id) : null;
    if (cached) store.setSignedIn(cached);
    else await signOutUser();
  }
}

/**
 * Keeps the session store in step with Supabase Auth. Anyone without an active profile is
 * signed out straight away (SEC-02). Sessions ended on the server (SEC-04, AUTH-04) arrive
 * here as a null session when their token refresh is refused.
 */
export function startAuthListener(): () => void {
  if (openedFromPasswordLink) useSession.getState().setPasswordSetup(true);
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // Supabase calls this while holding its auth lock; calling it back from inside would
    // deadlock, so the work runs on the next tick.
    setTimeout(() => void handleAuthChange(event, session), 0);
  });
  return () => {
    data.subscription.unsubscribe();
    stopWatchingProfile();
  };
}
