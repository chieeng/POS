// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Cloudflare Pages serves the build with the rules in public/_headers (SEC-12).
const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));
const headersFile = readFileSync(`${publicDir}_headers`, 'utf8');

/** The headers listed under one path rule, by lower-case name. */
function headersFor(path: string): Map<string, string> {
  const lines = headersFile.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#'));
  const start = lines.findIndex((line) => line === path);
  const rules = new Map<string, string>();
  if (start < 0) return rules;
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const colon = line.indexOf(':');
    rules.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return rules;
}

describe('every page is served with the security headers (SEC-12)', () => {
  const all = headersFor('/*');

  test('a Content-Security-Policy that allows only this site, Supabase and Turnstile', () => {
    const csp = all.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('connect-src');
    expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.supabase\.co/);
    expect(csp).toMatch(/connect-src [^;]*wss:\/\/\*\.supabase\.co/);
    expect(csp).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  test('HSTS, framing, sniffing, referrer and permissions', () => {
    expect(all.get('strict-transport-security')).toMatch(/max-age=\d{8,}/);
    expect(all.get('x-frame-options')).toBe('DENY');
    expect(all.get('x-content-type-options')).toBe('nosniff');
    expect(all.get('referrer-policy')).toBe('no-referrer');
    expect(all.get('permissions-policy')).toContain('camera=()');
  });
});

test('hashed assets are cached for a year', () => {
  expect(headersFor('/assets/*').get('cache-control')).toContain('immutable');
});

test('every route falls back to index.html (single-page app)', () => {
  // Pages serves index.html for unknown paths only when the build has no top-level 404.html.
  expect(existsSync(`${publicDir}404.html`)).toBe(false);
  expect(existsSync(`${publicDir}_redirects`)).toBe(false);
});
