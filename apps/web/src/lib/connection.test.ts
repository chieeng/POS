import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_URL,
  check,
  isOnline,
  noteServerAnswer,
  onReconnect,
  resetConnectionForTests,
  startConnectionCheck,
  subscribeConnection,
  trackedFetch,
} from './connection';

// The Nov 23, 2026 step 11 test: a laptop on Wi-Fi with no internet still said "Online".

type Answer = 'ok' | 'down' | 'portal';
let answer: Answer = 'ok';
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  void url;
  void init;
  if (answer === 'down') return Promise.reject(new TypeError('Failed to fetch'));
  const body = answer === 'ok' ? 'ok\n' : '<html>Sign in to this Wi-Fi</html>';
  return Promise.resolve(new Response(body, { status: 200 }));
});

const setBrowserOnline = (value: boolean) =>
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });

let stop: () => void = () => undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  answer = 'ok';
  setBrowserOnline(true);
  resetConnectionForTests();
});
afterEach(() => {
  stop();
  resetConnectionForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setBrowserOnline(true);
});

describe('the connection check', () => {
  it('Wi-Fi without internet reads as offline after two failed checks, then online again', async () => {
    const changes = vi.fn();
    const reconnected = vi.fn();
    subscribeConnection(changes);
    onReconnect(reconnected);
    answer = 'down';
    await check();
    expect(isOnline()).toBe(true); // one failure may be a blip
    await check();
    expect(isOnline()).toBe(false);
    expect(changes).toHaveBeenCalled();
    answer = 'ok';
    await check();
    expect(isOnline()).toBe(true);
    expect(reconnected).toHaveBeenCalledTimes(1);
  });

  it('never reads a stored copy: no cache, a new address each time, nothing sent along', async () => {
    await check();
    vi.setSystemTime(Date.now() + 1000);
    await check();
    const [first, second] = fetchMock.mock.calls;
    expect(first?.[0]).toMatch(new RegExp(`^${CHECK_URL}\\?t=\\d+$`));
    expect(second?.[0]).not.toBe(first?.[0]);
    expect(first?.[1]).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  });

  it('a Wi-Fi sign-in page answering in its place is not the internet', async () => {
    answer = 'portal';
    await check();
    await check();
    expect(isOnline()).toBe(false);
  });

  it('the browser saying offline counts at once, without a check', async () => {
    setBrowserOnline(false);
    expect(isOnline()).toBe(false);
    await check();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('any answer from Supabase means online at once', async () => {
    answer = 'down';
    await check();
    await check();
    expect(isOnline()).toBe(false);
    noteServerAnswer();
    expect(isOnline()).toBe(true);
  });

  it('skips the check while Supabase answered in the last minute', async () => {
    noteServerAnswer();
    await check();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Supabase calls feed the status; a failed one checks at once', async () => {
    stop = startConnectionCheck();
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();
    answer = 'down';
    await expect(trackedFetch('https://x.supabase.co/rest/v1/x')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(CHECK_URL))).toBe(true);
  });

  it('on its own, Wi-Fi without internet shows as offline within seconds, and back', async () => {
    stop = startConnectionCheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(isOnline()).toBe(true);
    answer = 'down';
    await vi.advanceTimersByTimeAsync(60_000); // the next minute's check fails once
    expect(isOnline()).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000); // confirmed 5 seconds later
    expect(isOnline()).toBe(false);
    answer = 'ok';
    await vi.advanceTimersByTimeAsync(10_000); // offline: checked every 10 seconds
    expect(isOnline()).toBe(true);
  });

  it('light on data and battery: once a minute online, only while on screen', async () => {
    stop = startConnectionCheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
