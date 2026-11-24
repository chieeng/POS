/**
 * Whether the app can really reach the internet (NFR-02; the Nov 23, 2026 step 11 test: a
 * laptop on Wi-Fi with no internet still said "Online").
 *
 * The browser's own signal (`navigator.onLine`) only knows whether there is a network link,
 * so it says online on Wi-Fi without internet. On top of it, the app fetches a tiny file
 * from its own host (Cloudflare Pages, never Supabase) now and then:
 *
 * - The browser saying offline counts at once.
 * - A check that fails twice in a row counts as offline; any check that works, or any answer
 *   from Supabase (see lib/supabase.ts), counts as online again at once.
 * - Checks run only while the app is on screen: every 60 seconds while online (skipped when
 *   Supabase answered in the last 60 seconds), every 10 seconds while offline.
 *
 * The check never reads a cached copy: the file is not in the service worker's cache, the
 * request asks for no cache and has a new address each time, and the host sends it with
 * `Cache-Control: no-store` (public/_headers). Its body must be exactly "ok", so a Wi-Fi
 * sign-in page answering in its place doesn't count as online.
 *
 * Nothing here blocks work: sending the outbox doesn't wait for this (lib/outbox.ts uses the
 * browser's signal and simply tries), so a wrong "offline" only delays the next send.
 */

export const CHECK_URL = '/online.txt';
export const ONLINE_EVERY_MS = 60_000;
export const OFFLINE_EVERY_MS = 10_000;
export const CONFIRM_AFTER_MS = 5_000;
export const CHECK_TIMEOUT_MS = 8_000;

let reachable = true;
let failures = 0;
let lastServerAnswer = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let checking = false;
let started = false;
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();

const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine;
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** Online for the app: a network link, and the internet answered lately. */
export function isOnline(): boolean {
  return browserOnline() && reachable;
}

/** For useSyncExternalStore: told when isOnline() may have changed. */
export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** Called when the internet comes back after the checks had found it down. */
export function onReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

function setReachable(next: boolean) {
  if (next === reachable) return;
  reachable = next;
  listeners.forEach((listener) => listener());
  if (next) reconnectListeners.forEach((listener) => listener());
}

function schedule(ms: number) {
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void check(), ms);
}

function nextCheck() {
  // One failure while online: confirm it soon, so Wi-Fi without internet shows within seconds.
  schedule(failures === 1 ? CONFIRM_AFTER_MS : reachable ? ONLINE_EVERY_MS : OFFLINE_EVERY_MS);
}

/** One check now (skipped while the browser says offline or the app is hidden). */
export async function check(): Promise<void> {
  if (checking) return;
  if (!browserOnline() || !visible()) {
    // The browser's offline event and coming back on screen start the checks again.
    if (timer) clearTimeout(timer);
    timer = null;
    return;
  }
  // Supabase answered a moment ago: the internet works, no need to ask.
  if (reachable && Date.now() - lastServerAnswer < ONLINE_EVERY_MS) {
    nextCheck();
    return;
  }
  checking = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  let ok: boolean;
  try {
    const response = await fetch(`${CHECK_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    ok = response.ok && (await response.text()).trim() === 'ok';
  } catch {
    ok = false;
  } finally {
    clearTimeout(timeout);
    checking = false;
  }
  if (ok) {
    failures = 0;
    setReachable(true);
  } else {
    failures += 1;
    if (failures >= 2) setReachable(false);
  }
  nextCheck();
}

/** Supabase answered (any status): the internet works. */
export function noteServerAnswer(): void {
  lastServerAnswer = Date.now();
  failures = 0;
  setReachable(true);
}

/** A request to Supabase failed to reach it: check now instead of waiting. */
export function noteNetworkFailure(): void {
  lastServerAnswer = 0;
  if (started && !checking) schedule(0);
}

/** Starts the checks; called once when the app starts (main.tsx). */
export function startConnectionCheck(): () => void {
  if (started) return () => undefined;
  started = true;
  const now = () => {
    lastServerAnswer = 0;
    schedule(0);
  };
  const onOffline = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const onVisible = () => {
    if (visible()) now();
  };
  window.addEventListener('online', now);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  schedule(0);
  return () => {
    started = false;
    if (timer) clearTimeout(timer);
    timer = null;
    window.removeEventListener('online', now);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Wraps fetch for the Supabase client: its answers and failures feed the status. */
export const trackedFetch: typeof fetch = async (input, init) => {
  try {
    const response = await fetch(input, init);
    noteServerAnswer();
    return response;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) noteNetworkFailure();
    throw error;
  }
};

/** Tests only: back to the start. */
export function resetConnectionForTests(): void {
  reachable = true;
  failures = 0;
  lastServerAnswer = 0;
  checking = false;
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
  listeners.clear();
  reconnectListeners.clear();
}
