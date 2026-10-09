import { describe, expect, test } from 'vitest';
import { readEnv } from './env';

const real = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'pos-staging.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'pos-staging',
  VITE_FIREBASE_STORAGE_BUCKET: 'pos-staging.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
};

describe('readEnv', () => {
  test('the dev server uses the emulators and a demo project by default', () => {
    const env = readEnv({ DEV: true });
    expect(env.useEmulators).toBe(true);
    expect(env.firebase.projectId).toBe('demo-pos');
  });

  test('a production build never uses the emulators', () => {
    const env = readEnv({ ...real, DEV: false, VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'site' });
    expect(env.useEmulators).toBe(false);
    expect(env.firebase.projectId).toBe('pos-staging');
  });

  test('a production build without Firebase config fails', () => {
    expect(() => readEnv({ DEV: false })).toThrow(/Missing Firebase config/);
  });

  test('a production build without an App Check site key fails (SEC-06)', () => {
    expect(() => readEnv({ ...real, DEV: false })).toThrow(/RECAPTCHA/);
  });

  test('the App Check debug token is ignored outside development', () => {
    const env = readEnv({
      ...real,
      DEV: false,
      VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'site',
      VITE_APPCHECK_DEBUG_TOKEN: 'debug',
    });
    expect(env.appCheckDebugToken).toBeUndefined();
  });

  test('dev can target a real project with VITE_USE_EMULATORS=false', () => {
    const env = readEnv({ ...real, DEV: true, VITE_USE_EMULATORS: 'false' });
    expect(env.useEmulators).toBe(false);
    expect(env.firebase.projectId).toBe('pos-staging');
  });
});
