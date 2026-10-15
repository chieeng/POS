/**
 * Writes apps/web/.env.local for LOCAL DEVELOPMENT from the running local Supabase stack
 * (`npx supabase start`), so nobody copies keys by hand.
 *
 * Only the two public values are written: the local API URL and the local anon key. The
 * service role key is never read into the file, and nothing is printed. .env.local is
 * git-ignored.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'apps/web/.env.local';
const MANAGED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

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
if (status.status !== 0 || !local.API_URL || !local.ANON_KEY) {
  console.error('The local Supabase stack is not running. Start it with `npx supabase start`.');
  process.exit(1);
}

// Keep anything else already in the file (store name, a Turnstile key).
const kept = existsSync(TARGET)
  ? readFileSync(TARGET, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !MANAGED.some((name) => line.startsWith(`${name}=`)))
  : ['VITE_STORE_NAME=Local Test Store'];

writeFileSync(
  TARGET,
  [
    `VITE_SUPABASE_URL=${local.API_URL}`,
    `VITE_SUPABASE_ANON_KEY=${local.ANON_KEY}`,
    ...kept,
    '',
  ].join('\n'),
);
console.log(`Wrote ${TARGET} for the local Supabase stack.`);
