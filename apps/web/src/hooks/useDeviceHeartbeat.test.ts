import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { registerDevice } from '@/lib/device';
import { HEARTBEAT_MS, useDeviceHeartbeat } from './useDeviceHeartbeat';

vi.mock('@/lib/device', () => ({ registerDevice: vi.fn(() => Promise.resolve()) }));

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

test('stamps once at the start, then every 4 minutes while visible (SYS-02)', () => {
  renderHook(() => useDeviceHeartbeat('u1', true, false));
  expect(registerDevice).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(HEARTBEAT_MS);
  expect(registerDevice).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(HEARTBEAT_MS);
  expect(registerDevice).toHaveBeenCalledTimes(3);
});

test('a hidden tab does not stamp, and stamps on coming back once due', () => {
  renderHook(() => useDeviceHeartbeat('u1', true, false));
  setVisibility('hidden');
  vi.advanceTimersByTime(3 * HEARTBEAT_MS);
  expect(registerDevice).toHaveBeenCalledTimes(1);
  setVisibility('visible');
  expect(registerDevice).toHaveBeenCalledTimes(2);
});

test('coming back soon after a stamp does not stamp again', () => {
  renderHook(() => useDeviceHeartbeat('u1', true, false));
  setVisibility('hidden');
  vi.advanceTimersByTime(60_000);
  setVisibility('visible');
  expect(registerDevice).toHaveBeenCalledTimes(1);
});

test('the idle lock stops the stamps', () => {
  const { rerender } = renderHook(({ locked }) => useDeviceHeartbeat('u1', true, locked), {
    initialProps: { locked: false },
  });
  rerender({ locked: true });
  vi.advanceTimersByTime(3 * HEARTBEAT_MS);
  expect(registerDevice).toHaveBeenCalledTimes(1);
});

test('two tabs of the same browser share one stamp per interval', () => {
  renderHook(() => useDeviceHeartbeat('u1', true, false));
  renderHook(() => useDeviceHeartbeat('u1', true, false));
  // Each tab registers once when its session starts.
  expect(registerDevice).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(HEARTBEAT_MS);
  expect(registerDevice).toHaveBeenCalledTimes(3);
});

test('nothing is stamped when not signed in or the Owner has not passed two-step', () => {
  renderHook(() => useDeviceHeartbeat('u1', false, false));
  vi.advanceTimersByTime(3 * HEARTBEAT_MS);
  expect(registerDevice).not.toHaveBeenCalled();
});
