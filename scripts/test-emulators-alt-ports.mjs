/**
 * Runs `npm run test:emulators:run` in a throwaway Emulator Suite on spare ports, so the
 * tests can run while `npm run emulators` is open in another terminal without wiping its
 * data. Uses the real firebase.json rules, like CI.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const CONFIG = 'firebase.test-ports.json';
const config = JSON.parse(readFileSync('firebase.json', 'utf8'));
config.emulators = {
  auth: { port: 19099 },
  firestore: { port: 18080 },
  storage: { port: 19199 },
  hub: { port: 14400 },
  logging: { port: 14500 },
  ui: { enabled: false },
  singleProjectMode: true,
};
writeFileSync(CONFIG, JSON.stringify(config, null, 2));

let status;
try {
  const result = spawnSync(
    'npx',
    [
      'firebase',
      'emulators:exec',
      '--config',
      CONFIG,
      '--only',
      'auth,firestore,storage',
      '--project',
      'demo-pos',
      '"npm run test:emulators:run"',
    ],
    { stdio: 'inherit', shell: true },
  );
  status = result.status ?? 1;
} finally {
  rmSync(CONFIG, { force: true });
}
process.exit(status);
