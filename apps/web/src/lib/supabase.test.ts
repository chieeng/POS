import { describe, expect, test } from 'vitest';
import { readEnv } from './supabase';

const real = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'public-anon-key',
  VITE_TURNSTILE_SITE_KEY: 'site-key',
};

const jwtWithRole = (role: string) =>
  `header.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.signature`;

describe('readEnv', () => {
  test('reads the Supabase URL, anon key and store text', () => {
    const env = readEnv({ ...real, DEV: false, VITE_STORE_NAME: ' Sari Store ' });
    expect(env.supabaseUrl).toBe('https://abcdefghijklmnop.supabase.co');
    expect(env.supabaseAnonKey).toBe('public-anon-key');
    expect(env.turnstileSiteKey).toBe('site-key');
    expect(env.storeName).toBe('Sari Store');
    expect(env.storeAddress).toBeUndefined();
  });

  test('a build without Supabase config fails', () => {
    expect(() => readEnv({ DEV: false })).toThrow(/Missing Supabase config/);
    expect(() => readEnv({ DEV: true })).toThrow(/Missing Supabase config/);
    expect(() => readEnv({ ...real, DEV: false, VITE_SUPABASE_URL: 'not a url' })).toThrow(
      /VITE_SUPABASE_URL/,
    );
    expect(() => readEnv({ ...real, DEV: false, VITE_SUPABASE_ANON_KEY: ' ' })).toThrow(
      /VITE_SUPABASE_ANON_KEY/,
    );
  });

  test('a service role or secret key is refused (SEC-10)', () => {
    for (const key of [jwtWithRole('service_role'), 'sb_secret_abc123']) {
      expect(() => readEnv({ ...real, DEV: false, VITE_SUPABASE_ANON_KEY: key })).toThrow(
        /server key/,
      );
      expect(() => readEnv({ ...real, DEV: true, VITE_SUPABASE_ANON_KEY: key })).toThrow(
        /server key/,
      );
    }
    expect(
      readEnv({ ...real, DEV: false, VITE_SUPABASE_ANON_KEY: jwtWithRole('anon') }).supabaseAnonKey,
    ).toBe(jwtWithRole('anon'));
  });

  test('a production build must use https (NFR-04)', () => {
    const local = { ...real, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' };
    expect(() => readEnv({ ...local, DEV: false })).toThrow(/https/);
    expect(readEnv({ ...local, DEV: true }).supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  test('a production build without a Turnstile site key fails (SEC-06)', () => {
    expect(() => readEnv({ ...real, DEV: false, VITE_TURNSTILE_SITE_KEY: '' })).toThrow(
      /TURNSTILE/,
    );
  });

  test('the dev server falls back to the Turnstile test key', () => {
    const env = readEnv({ ...real, DEV: true, VITE_TURNSTILE_SITE_KEY: undefined });
    expect(env.turnstileSiteKey).toBe('1x00000000000000000000AA');
  });
});
