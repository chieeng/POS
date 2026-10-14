/**
 * ONE-TIME SCRIPT: creates the first Owner account of a Supabase project (SEC-03).
 *
 * DELETE THIS FILE (and the "bootstrap-owner" npm script) once the production Owner exists.
 * Every later account is created by the Owner inside the app.
 *
 * It needs the project's service role key, which bypasses every policy. The key is read
 * from the environment of the terminal you run this in, and from nowhere else: never pass
 * it as an argument, never put it in a file in this repository, never paste it in a chat
 * (SEC-10). Close the terminal afterwards so the key is gone.
 *
 *   # PowerShell
 *   $env:SUPABASE_URL = "https://<project-ref>.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = Read-Host "Service role key"
 *   npm run bootstrap-owner -- --email owner@example.com --name "Full Name" --code RS `
 *     --app-url https://<your app> [--branch main] [--store "Store name"]
 *
 * The script contains no default password and creates nothing if an Owner already exists.
 * The Owner sets their own password through the one-time link printed at the end. Opening
 * the link only shows a Continue button; the link is used when that is pressed.
 *
 * If that link was lost or used up before the Owner chose a password, make a new one:
 *
 *   npm run bootstrap-owner -- --resend --email owner@example.com --app-url https://<your app>
 *
 * --resend only works for an active Owner who has not finished setting up (no sign-in in the
 * app, no authenticator app yet), and the new link cancels the old one. For an Owner who has
 * finished setting up, send a password recovery from the Supabase dashboard instead.
 *
 * Local development does not need this: `supabase/seed.sql` already has a local Owner.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface Options {
  resend: boolean;
  email: string;
  name: string;
  code: string;
  branch: string;
  store: string | undefined;
  appUrl: string;
}

/** A refusal with a message for the person running the script. Nothing else is printed. */
class Refusal extends Error {}

function fail(message: string): never {
  throw new Refusal(message);
}

function readOptions(): Options {
  const { values } = parseArgs({
    options: {
      resend: { type: 'boolean', default: false },
      email: { type: 'string' },
      name: { type: 'string' },
      code: { type: 'string' },
      branch: { type: 'string', default: 'main' },
      store: { type: 'string' },
      'app-url': { type: 'string' },
    },
    strict: true,
  });

  const email = values.email?.trim().toLowerCase() ?? '';
  const name = values.name?.trim() ?? '';
  const code = values.code?.trim().toUpperCase() ?? '';
  const branch = values.branch.trim();
  const appUrl = values['app-url']?.trim().replace(/\/+$/, '') ?? '';
  const resend = values.resend;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('--email must be a valid email address.');
  if (!/^https?:\/\/[^/\s]+$/.test(appUrl))
    fail('--app-url is required: the address of the app, such as https://pos.example.com');
  if (!resend) {
    if (name.length < 1 || name.length > 80) fail('--name is required (up to 80 characters).');
    if (!/^[A-Z0-9]{2,6}$/.test(code))
      fail('--code must be 2 to 6 letters or digits (for receipt numbers).');
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(branch))
      fail('--branch must be lowercase letters, digits or dashes.');
  }

  return { resend, email, name, code, branch, store: values.store?.trim() || undefined, appUrl };
}

/** The role inside a Supabase API key, without verifying it. Only used to catch mix-ups. */
function keyRole(key: string): string | undefined {
  if (key.startsWith('sb_secret_')) return 'service_role';
  if (key.startsWith('sb_publishable_')) return 'anon';
  try {
    const payload = Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8');
    const role = (JSON.parse(payload) as { role?: unknown }).role;
    return typeof role === 'string' ? role : undefined;
  } catch {
    return undefined;
  }
}

function readConnection(): { url: string; serviceRoleKey: string; isLocal: boolean } {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!/^https?:\/\/[^/\s]+$/.test(url)) {
    fail('Set SUPABASE_URL to the project URL, such as https://<project-ref>.supabase.co');
  }
  if (!serviceRoleKey) {
    fail(
      'Set SUPABASE_SERVICE_ROLE_KEY in this terminal only (see the top of this file).\n' +
        'It is never read from a file or an argument (SEC-10).',
    );
  }
  if (keyRole(serviceRoleKey) !== 'service_role') {
    fail('SUPABASE_SERVICE_ROLE_KEY is not a service role key. Nothing was changed.');
  }
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
  if (!isLocal && !url.startsWith('https://')) fail('SUPABASE_URL must use https.');
  return { url, serviceRoleKey, isLocal };
}

async function confirmProject(url: string, isLocal: boolean) {
  if (isLocal) {
    console.log('Using the local Supabase stack. No real project is touched.');
    return;
  }
  const host = new URL(url).host;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(
    `This creates the first Owner in the REAL project "${host}".\nType that address to continue: `,
  );
  prompt.close();
  if (answer.trim() !== host) fail('The address did not match. Nothing was changed.');
}

type Admin = SupabaseClient;

/**
 * A one-time link to the app's set-password screen. The token sits after "#", so it never
 * reaches a server, and it is used only when the Owner presses Continue there. Making a new
 * link cancels the previous one. Returns null if Supabase Auth would not make one.
 */
async function oneTimeLink(admin: Admin, email: string, appUrl: string): Promise<string | null> {
  const link = await admin.auth.admin.generateLink({ type: 'recovery', email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) return null;
  return `${appUrl}/set-password#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}

/** --resend: a new link for an Owner who has never signed in, for example after a lost link. */
async function resend(admin: Admin, options: Options) {
  const profile = await admin
    .from('profiles')
    .select('id, branch_id, role, active')
    .eq('email', options.email)
    .maybeSingle();
  if (profile.error) fail(`Could not read profiles (${profile.error.message}).`);
  const owner = profile.data as {
    id: string;
    branch_id: string;
    role: string;
    active: boolean;
  } | null;
  if (!owner || owner.role !== 'owner' || !owner.active) {
    fail('There is no active Owner with that email. Nothing was changed.');
  }

  // "Never set up" means: no sign-in recorded by the app and no authenticator app. Opening a
  // link and pressing Continue counts as a sign-in for Supabase Auth, so its own
  // last_sign_in_at cannot tell an abandoned set-up from a finished one.
  const signIns = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'auth.signIn')
    .eq('actor_id', owner.id);
  if (signIns.error) fail(`Could not read the audit log (${signIns.error.message}).`);
  const factors = await admin.auth.admin.mfa.listFactors({ userId: owner.id });
  if (factors.error) fail('Could not read that account. Nothing was changed.');
  if ((signIns.count ?? 0) > 0 || factors.data.factors.length > 0) {
    fail(
      'This Owner has already set up their account, so this script will not make a link.\n' +
        'If they lost their password, send a recovery from the Supabase dashboard\n' +
        '(Authentication > Users).',
    );
  }

  const link = await oneTimeLink(admin, options.email, options.appUrl);
  if (!link) fail('Supabase Auth would not make a link. Nothing was changed.');

  const audit = await admin.from('audit_logs').insert({
    branch_id: owner.branch_id,
    action: 'user.passwordResetLink',
    actor_id: owner.id,
    target_type: 'user',
    target_id: owner.id,
    reason: 'New one-time link from scripts/bootstrap-owner.ts --resend (SEC-03)',
  });
  if (audit.error) fail(`Could not write the audit entry (${audit.error.message}).`);

  console.log(`\nNew one-time link for ${options.email} (the previous one no longer works).`);
  console.log('Give it only to the Owner:\n');
  console.log(link);
  console.log(
    '\nNext: open the link, press Continue, choose a password, sign in, and turn on two-step' +
      '\nsign-in when asked. Then DELETE this script and close this terminal.\n',
  );
}

async function main() {
  const options = readOptions();
  const { url, serviceRoleKey, isLocal } = readConnection();
  await confirmProject(url, isLocal);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  if (options.resend) {
    await resend(admin, options);
    return;
  }

  const owners = await admin.from('profiles').select('id').eq('role', 'owner').limit(1);
  if (owners.error) {
    fail(`Could not read profiles (${owners.error.message}). Are the migrations applied?`);
  }
  if (owners.data.length > 0) {
    fail('An Owner already exists in this project. Nothing was changed. Delete this script.');
  }

  const branch = await admin.from('branches').select('id').eq('id', options.branch).maybeSingle();
  if (branch.error) fail(`Could not read branches (${branch.error.message}).`);
  if (!branch.data) {
    const made = await admin
      .from('branches')
      .insert({ id: options.branch, name: options.store ?? 'Store' });
    if (made.error) fail(`Could not create the branch (${made.error.message}).`);
  }

  const created = await admin.auth.admin.createUser({
    email: options.email,
    // Random and never shown: the Owner sets their own password through the link below.
    password: randomBytes(32).toString('base64url'),
    // You vouch for this address by running the script.
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    fail(`Could not create the account (${created.error?.message ?? 'no user returned'}).`);
  }
  const uid = created.data.user.id;

  const profile = await admin.from('profiles').insert({
    id: uid,
    display_name: options.name,
    email: options.email,
    role: 'owner',
    user_code: options.code,
    branch_id: options.branch,
    active: true,
  });
  if (profile.error) {
    // Do not leave a half-made account behind.
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    fail(`Could not create the Owner profile (${profile.error.message}). Nothing was kept.`);
  }

  const audit = await admin.from('audit_logs').insert({
    branch_id: options.branch,
    action: 'user.create',
    actor_id: uid,
    target_type: 'user',
    target_id: uid,
    after: {
      email: options.email,
      displayName: options.name,
      role: 'owner',
      userCode: options.code,
    },
    reason: 'First Owner created by scripts/bootstrap-owner.ts (SEC-03)',
  });
  if (audit.error) {
    await admin.from('profiles').delete().eq('id', uid);
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    fail(`Could not write the audit entry (${audit.error.message}). Nothing was kept.`);
  }

  const link = await oneTimeLink(admin, options.email, options.appUrl);

  console.log(`\nOwner created: ${options.email} (branch "${options.branch}").`);
  if (!link) {
    console.log(
      '\nThe account exists, but the one-time link could not be made.\n' +
        'Run this script again with --resend --email <same email> --app-url <same address>.',
    );
  } else {
    console.log('\nOne-time link to set the password (give it only to the Owner):\n');
    console.log(link);
  }
  console.log(
    '\nNext: open the link, press Continue, choose a password, sign in, and turn on two-step' +
      '\nsign-in when asked. If the link stops working before then, use --resend (see the top' +
      '\nof this file). Then DELETE this script and close this terminal.\n',
  );
}

main().catch((error: unknown) => {
  // Only the message: an error object could carry request details.
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  console.error(`\nError: ${message}\n`);
  // Not process.exit(): let open connections close on their own.
  process.exitCode = 1;
});
