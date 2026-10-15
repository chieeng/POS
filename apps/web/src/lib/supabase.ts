import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  turnstileSiteKey: string;
  storeName: string | undefined;
  storeAddress: string | undefined;
}

type RawEnv = Record<string, string | boolean | undefined>;

// Cloudflare's published Turnstile test site key: always passes, never shows a challenge.
// It pairs with the test secret the local Supabase stack uses (supabase/.env.example).
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

const configSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/ })),
  VITE_SUPABASE_ANON_KEY: z.string().trim().min(1),
});

function optional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** True if the key is a service role or secret key, which must never reach a browser. */
function isServerKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  try {
    const payload = key.split('.')[1] ?? '';
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: unknown;
    };
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

/**
 * Reads and validates the VITE_* variables. The URL and anon key are public by design
 * (SRS 6.3): access is enforced by Row Level Security and server functions, never by
 * anything in this bundle.
 */
export function readEnv(raw: RawEnv): AppEnv {
  const isDev = raw.DEV === true;

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Missing Supabase config (${missing}). See apps/web/.env.example.`);
  }
  const supabaseUrl = parsed.data.VITE_SUPABASE_URL.replace(/\/+$/, '');
  const supabaseAnonKey = parsed.data.VITE_SUPABASE_ANON_KEY;

  // SEC-10: the service role key bypasses every policy. Refuse to start with it.
  if (isServerKey(supabaseAnonKey)) {
    throw new Error('VITE_SUPABASE_ANON_KEY holds a server key. Use the anon (public) key.');
  }
  // NFR-04: HTTPS only. Plain HTTP is for the local stack on the dev server.
  if (!isDev && !supabaseUrl.startsWith('https://')) {
    throw new Error('VITE_SUPABASE_URL must be an https:// URL outside development.');
  }

  // SEC-06: a build that talks to a real project must run the CAPTCHA.
  const turnstileSiteKey = optional(raw.VITE_TURNSTILE_SITE_KEY);
  if (!isDev && !turnstileSiteKey) {
    throw new Error('VITE_TURNSTILE_SITE_KEY is required outside development.');
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    turnstileSiteKey: turnstileSiteKey ?? TURNSTILE_TEST_SITE_KEY,
    storeName: optional(raw.VITE_STORE_NAME),
    storeAddress: optional(raw.VITE_STORE_ADDRESS),
  };
}

export const env = readEnv(import.meta.env);

// How this page was opened, read before the client looks at the URL. A one-time password
// link (AUTH-02) carries its token after "#": nothing is used until the person presses
// Continue on the set-password screen, so a link preview or a scanner cannot use it up.
const openingHash = typeof window === 'undefined' ? '' : window.location.hash;
const linkParams = new URLSearchParams(openingHash.replace(/^#/, ''));
const linkToken = linkParams.get('type') === 'recovery' ? linkParams.get('token_hash') : null;

/** The token of the one-time link this page was opened with, waiting for Continue. */
export const passwordLinkToken: string | null =
  linkToken && linkToken.length <= 256 ? linkToken : null;
if (passwordLinkToken && typeof window !== 'undefined') {
  // Keep the token out of the address bar, history and bookmarks.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
// Older links, made by Supabase Auth itself, arrive already signed in.
export const openedFromPasswordLink =
  !passwordLinkToken && /[#&]type=recovery(&|$)/.test(openingHash);
export const passwordLinkFailed = /[#&]error(_code)?=/.test(openingHash);

/** Where this browser keeps the signed-in session. */
export const AUTH_STORAGE_KEY = 'pos.auth';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * A second client that keeps nothing: used only to check a password (idle lock, AUTH-05)
 * without replacing the signed-in session.
 */
export function createThrowawayClient() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'pos.password-check',
    },
  });
}
