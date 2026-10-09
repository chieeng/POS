import { defineConfig } from 'vitest/config';

// Unit tests only. Tests that need the Emulator Suite are named *.emu.test.ts and run
// through vitest.emu.config.ts (npm run test:emulators at the repo root).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.emu.test.ts'],
  },
});
