/**
 * Runs the Edge Function tests (Deno) against the LOCAL Supabase stack.
 *
 * The tests need the local stack's URL and keys. This reads them from `supabase status` and
 * hands them to Deno through the environment, so they are never printed, written to a file
 * or typed by hand. Start the stack first: `npx supabase start`.
 */
import { spawnSync } from 'node:child_process';

const status = spawnSync('npx supabase status -o env', {
  encoding: 'utf8',
  shell: true,
  stdio: ['ignore', 'pipe', 'ignore'],
});
const local = Object.fromEntries(
  (status.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

if (status.status !== 0 || !local.API_URL || !local.ANON_KEY || !local.SERVICE_ROLE_KEY) {
  console.error('The local Supabase stack is not running. Start it with `npx supabase start`.');
  process.exit(1);
}

const result = spawnSync(
  'deno test --allow-net=127.0.0.1,localhost --allow-env' +
    ' --config supabase/functions/admin-users/deno.json supabase/functions/admin-users',
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      SUPABASE_URL: local.API_URL,
      SUPABASE_ANON_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    },
  },
);
process.exit(result.status ?? 1);
