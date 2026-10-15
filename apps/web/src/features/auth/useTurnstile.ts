import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { env } from '@/lib/supabase';
import { APP_ERROR } from './authErrors';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
// A token is waited for this long before the attempt is given up as "no connection".
const TOKEN_TIMEOUT_MS = 30_000;

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      execution: 'execute';
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
      'timeout-callback': () => void;
    },
  ) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

function captchaUnavailable(): Error {
  return Object.assign(new Error('The CAPTCHA could not be loaded.'), {
    code: APP_ERROR.captchaUnavailable,
  });
}

let scriptLoading: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  const ready = (window as { turnstile?: TurnstileApi }).turnstile;
  if (ready) return Promise.resolve(ready);
  scriptLoading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const api = (window as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(captchaUnavailable());
    };
    script.onerror = () => {
      script.remove();
      // Let the next attempt try again, for instance once the connection is back.
      scriptLoading = undefined;
      reject(captchaUnavailable());
    };
    document.head.append(script);
  });
  return scriptLoading;
}

export interface Turnstile {
  /** Put this on an empty element where a challenge may appear if Cloudflare asks for one. */
  containerRef: RefObject<HTMLDivElement>;
  /** A fresh single-use token for one sign-in attempt (SEC-06). */
  getToken: () => Promise<string>;
}

/**
 * Cloudflare Turnstile for sign-in (SEC-06). The widget is "interaction-only": it stays
 * invisible unless Cloudflare decides this visitor must solve a challenge. Supabase Auth
 * checks the token on the server; nothing here is trusted.
 */
export function useTurnstile(): Turnstile {
  const containerRef = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const waiting = useRef<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
  } | null>(null);

  useEffect(() => {
    // Warm the script up so the first sign-in does not wait for it.
    loadTurnstile().catch(() => undefined);
    return () => {
      waiting.current?.reject(captchaUnavailable());
      waiting.current = null;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
    };
  }, []);

  const getToken = useCallback(async () => {
    const api = await loadTurnstile();
    const container = containerRef.current;
    if (!container) throw captchaUnavailable();

    const settle = (action: 'resolve' | 'reject', token = '') => {
      const pending = waiting.current;
      waiting.current = null;
      if (!pending) return;
      if (action === 'resolve') pending.resolve(token);
      else pending.reject(captchaUnavailable());
    };

    if (!widget.current) {
      const id = api.render(container, {
        sitekey: env.turnstileSiteKey,
        appearance: 'interaction-only',
        execution: 'execute',
        callback: (token) => settle('resolve', token),
        'error-callback': () => settle('reject'),
        'expired-callback': () => settle('reject'),
        'timeout-callback': () => settle('reject'),
      });
      widget.current = { api, id };
    } else {
      // Tokens are single-use: start clean for every attempt.
      api.reset(widget.current.id);
    }

    const { id } = widget.current;
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => settle('reject'), TOKEN_TIMEOUT_MS);
      waiting.current = {
        resolve: (token) => {
          window.clearTimeout(timer);
          resolve(token);
        },
        reject: (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      };
      api.execute(id);
    });
  }, []);

  return { containerRef, getToken };
}
