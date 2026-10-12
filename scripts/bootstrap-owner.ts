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
 * The Owner sets their own password through the one-time link printed at the end.
 *
 * Local development does not need this: `supabase/seed.sql` already has a local Owner.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

interface Options {
  email: string;
  name: string;
  code: string;
  branch: string;
  store: string | undefined;
  appUrl: string | undefined;
}

/** A refusal with a message for the person running the script. Nothing else is printed. */
class Refusal extends Error {}

function fail(message: string): never {
  throw new Refusal(message);
}

function readOptions(): Options {
  const { values } = parseArgs({
    options: {
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
  const appUrl = values['app-url']?.trim().replace(/\/+$/, '') || undefined;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('--email must be a valid email address.');
  if (name.length < 1 || name.length > 80) fail('--name is required (up to 80 characters).');
  if (!/^[A-Z0-9]{2,6}$/.test(code))
    fail('--code must be 2 to 6 letters or digits (for receipt numbers).');
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(branch))
    fail('--branch must be lowercase letters, digits or dashes.');
  if (appUrl && !/^https?:\/\/[^/\s]+$/.test(appUrl))
    fail('--app-url must be the address of the app, such as https://pos.example.com');

  return { email, name, code, branch, store: values.store?.trim() || undefined, appUrl };
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

async function main() {
  const options = readOptions();
  const { url, serviceRoleKey, isLocal } = readConnection();
  await confirmProject(url, isLocal);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

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

  const link = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: options.email,
    options: options.appUrl ? { redirectTo: `${options.appUrl}/set-password` } : undefined,
  });
  const actionLink = link.data?.properties?.action_link;

  console.log(`\nOwner created: ${options.email} (branch "${options.branch}").`);
  if (link.error || !actionLink) {
    console.log(
      '\nThe account exists, but the one-time link could not be made ' +
        `(${link.error?.message ?? 'no link returned'}).\n` +
        'In the Supabase dashboard open Authentication > Users and send a password recovery.',
    );
  } else {
    console.log('\nOne-time link to set the password (give it only to the Owner):\n');
    console.log(actionLink);
  }
  console.log(
    '\nNext: open the link, choose a password, sign in, and turn on two-step sign-in when' +
      '\nasked. Then DELETE this script and close this terminal.\n',
  );
}

main().catch((error: unknown) => {
  // Only the message: an error object could carry request details.
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  console.error(`\nError: ${message}\n`);
  // Not process.exit(): let open connections close on their own.
  process.exitCode = 1;
});
