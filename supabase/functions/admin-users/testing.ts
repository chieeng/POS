// Helpers for the admin-users integration tests. They talk to the LOCAL Supabase stack
// (`npx supabase start`) and are never deployed: index.ts does not import this file.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value)
    throw new Error(`${name} is not set. Run these tests with \`npm run test:functions\`.`);
  return value;
}

const URL = required('SUPABASE_URL');
const ANON_KEY = required('SUPABASE_ANON_KEY');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  throw new Error('These tests create and change accounts. They only run against a local stack.');
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
// Local accounts only; the same password seed.sql uses.
export const PASSWORD = 'password1234';
// The local stack uses Cloudflare's always-pass Turnstile test secret, which accepts this.
const CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export const admin = createClient(URL, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: NO_SESSION });

/** Unique per run, so runs never collide and nothing needs deleting (users are never deleted). */
export const RUN = crypto.randomUUID().slice(0, 8);

export interface TestUser {
  id: string;
  email: string;
}

export async function createBranch(suffix: string): Promise<string> {
  const id = `fn-${RUN}-${suffix}`;
  const { error } = await admin.from('branches').insert({ id, name: `Function test ${suffix}` });
  if (error) throw new Error(`branch: ${error.message}`);
  return id;
}

let codeCounter = 0;
/** A user code that is unique inside this run: T0, T1, ... */
export function nextCode(): string {
  return `T${(codeCounter++).toString(36).toUpperCase()}`;
}

/** An Auth account, with a profile unless `role` is null. */
export async function seedUser(
  name: string,
  role: 'owner' | 'special_sales' | 'sales' | null,
  branchId?: string,
): Promise<TestUser> {
  const email = `${name}.${RUN}@fn.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`seed ${name}: ${error?.message}`);
  if (role) {
    const { error: profileError } = await admin.from('profiles').insert({
      id: data.user.id,
      display_name: name,
      email,
      role,
      user_code: nextCode(),
      branch_id: branchId,
    });
    if (profileError) throw new Error(`seed profile ${name}: ${profileError.message}`);
  }
  return { id: data.user.id, email };
}

export interface SignedIn {
  client: SupabaseClient;
  token: string;
}

async function tokenOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('no session');
  return data.session.access_token;
}

/** Email and password only: an aal1 session. Returns null if the sign-in is refused. */
export async function signIn(user: TestUser): Promise<SignedIn | null> {
  const client = createClient(URL, ANON_KEY, { auth: NO_SESSION });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: PASSWORD,
    options: { captchaToken: CAPTCHA_TOKEN },
  });
  if (error) return null;
  return { client, token: await tokenOf(client) };
}

function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bytes;
}

/** The current 6-digit code for a TOTP secret (RFC 6238, SHA-1, 30 seconds). */
async function totpCode(secret: string): Promise<string> {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 30_000)));
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = new DataView(mac.buffer).getUint32(offset) & 0x7fffffff;
  return (binary % 1_000_000).toString().padStart(6, '0');
}

/** Signs in, enrols an authenticator app and passes the second step: an aal2 session. */
export async function signInWithSecondStep(user: TestUser): Promise<SignedIn> {
  const signedIn = await signIn(user);
  if (!signedIn) throw new Error(`could not sign in ${user.email}`);
  const { client } = signedIn;

  const enrolled = await client.auth.mfa.enroll({ factorType: 'totp' });
  if (enrolled.error) throw new Error(`enroll: ${enrolled.error.message}`);
  const challenge = await client.auth.mfa.challenge({ factorId: enrolled.data.id });
  if (challenge.error) throw new Error(`challenge: ${challenge.error.message}`);
  const verified = await client.auth.mfa.verify({
    factorId: enrolled.data.id,
    challengeId: challenge.data.id,
    code: await totpCode(enrolled.data.totp.secret),
  });
  if (verified.error) throw new Error(`verify: ${verified.error.message}`);
  return { client, token: await tokenOf(client) };
}

export interface CallResult {
  status: number;
  code: string | undefined;
  message: string | undefined;
  body: Record<string, unknown>;
}

/** Calls the function the way the web app does. `token` null sends no Authorization header. */
export async function call(token: string | null, body: unknown): Promise<CallResult> {
  const response = await fetch(`${URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const error = parsed.error as { code?: string; message?: string } | undefined;
  return { status: response.status, code: error?.code, message: error?.message, body: parsed };
}

export { ANON_KEY };

/** A client holding nothing but the public URL and anon key, like any stranger. */
export function strangerClient(): SupabaseClient {
  return createClient(URL, ANON_KEY, { auth: NO_SESSION });
}

export async function profileOf(id: string) {
  const { data, error } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

export async function auditOf(action: string, targetId: string) {
  const { data, error } = await admin
    .from('audit_logs')
    .select('*')
    .eq('action', action)
    .eq('target_id', targetId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/** True while the token's session still works against the database. */
export async function sessionWorks(signedIn: SignedIn): Promise<boolean> {
  const { data } = await signedIn.client.auth.getUser(signedIn.token);
  return Boolean(data.user);
}

/** Rows of a table as seen with exactly this access token, straight from the REST API. */
export async function rowsWithToken(token: string, table: string): Promise<unknown[]> {
  const response = await fetch(`${URL}/rest/v1/${table}?select=*`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
  return (await response.json()) as unknown[];
}
