import { beforeEach, describe, expect, test, vi } from 'vitest';
import { describeDevice, generateDeviceTag, getDeviceTag } from './device';

vi.mock('./firebase', () => ({ db: {} }));

beforeEach(() => localStorage.clear());

describe('device tag (SYS-02)', () => {
  test('is four unambiguous characters', () => {
    for (let i = 0; i < 50; i++) expect(generateDeviceTag()).toMatch(/^[A-HJKMNP-Z2-9]{4}$/);
  });

  test('is created once and then reused', () => {
    const first = getDeviceTag();
    expect(getDeviceTag()).toBe(first);
    expect(localStorage.getItem('pos.deviceTag')).toBe(first);
  });

  test('replaces a stored value that is not a valid tag', () => {
    localStorage.setItem('pos.deviceTag', '<script>');
    expect(getDeviceTag()).toMatch(/^[A-Z0-9]{4}$/);
  });
});

test.each([
  [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36',
    'Android phone · Chrome',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
    'iPhone · Safari',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0',
    'Windows PC · Edge',
  ],
  [
    'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
    'Android tablet · Chrome',
  ],
  ['something else', 'Device · Browser'],
])('describeDevice(%s)', (ua, label) => {
  expect(describeDevice(ua)).toBe(label);
});
