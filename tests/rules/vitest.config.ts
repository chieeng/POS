import { defineConfig } from 'vitest/config';

// Security Rules tests. They need the Firestore and Storage emulators:
// run `npm run test:emulators` from the repo root.
export default defineConfig({
  test: {
    environment: 'node',
    root: import.meta.dirname,
    include: ['**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
