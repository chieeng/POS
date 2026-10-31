import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unit tests never load Cloudflare's script: every screen gets a ready token.
vi.mock('@/features/auth/useTurnstile', () => ({
  useTurnstile: () => ({
    containerRef: { current: null },
    getToken: () => Promise.resolve('test-captcha-token'),
  }),
}));

// jsdom has no ResizeObserver; Radix's Checkbox measures itself with one inside a form.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
});
