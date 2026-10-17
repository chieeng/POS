import { afterEach, expect, test, vi } from 'vitest';
import { checkPwnedPassword } from './pwnedPasswords';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

function answer(body: string, status = 200) {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(body, { status })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('sends only the first 5 characters of the hash, asking for padding', async () => {
  const fetchMock = answer('');
  await checkPwnedPassword('password');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
  expect(init.headers).toEqual({ 'Add-Padding': 'true' });
  expect(init.credentials).toBe('omit');
});

test('a password in the list is reported as breached', async () => {
  answer(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:9659365\r\n`);
  expect(await checkPwnedPassword('password')).toBe('breached');
});

test('a padding entry (count 0) is not a match', async () => {
  answer(`${SUFFIX}:0\r\n`);
  expect(await checkPwnedPassword('password')).toBe('not-found');
});

test('a password not in the list is not-found', async () => {
  answer('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n');
  expect(await checkPwnedPassword('password')).toBe('not-found');
});

test('an error answer or no connection is unknown, never breached', async () => {
  answer('', 503);
  expect(await checkPwnedPassword('password')).toBe('unknown');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
  expect(await checkPwnedPassword('password')).toBe('unknown');
});
