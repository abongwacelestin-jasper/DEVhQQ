/**
 * Cloudflare Turnstile on the public auth forms (sign-in, recovery, invite).
 *
 * The server decides: `GET /api/auth/config` says whether the widget is on and
 * which public site key to use. While it is off (the default), or the server
 * cannot be reached, nothing is loaded from Cloudflare. While it is on, the
 * script is loaded once, with `render=explicit`, and each form renders its own
 * widget (Backend/security/turnstile.ts verifies the token server-side).
 */

import { useEffect, useState } from 'react';
import { api } from '../client';

export type TurnstileAction = 'sign-in' | 'recover' | 'accept-invite';

export interface TurnstileSettings {
  mode: 'on' | 'off';
  siteKey: string | null;
}

/** GET /api/auth/config */
export interface AuthConfigResponse {
  turnstile?: { mode?: string; siteKey?: string | null };
}

const OFF: TurnstileSettings = { mode: 'off', siteKey: null };
export const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Error codes the API answers when the check is missing, rejected or unavailable. */
export const TURNSTILE_ERRORS = new Set([
  'turnstile_required',
  'turnstile_failed',
  'turnstile_unavailable',
]);

export async function getTurnstileSettings(): Promise<TurnstileSettings> {
  try {
    const r = await api<AuthConfigResponse>('/api/auth/config', { silent: true });
    const t = r?.turnstile;
    return t?.mode === 'on' && typeof t.siteKey === 'string' && t.siteKey
      ? { mode: 'on', siteKey: t.siteKey }
      : OFF;
  } catch {
    // An older API without the route, or the API is down: no widget.
    return OFF;
  }
}

let cached: Promise<TurnstileSettings> | null = null;

/** Turnstile settings as the server publishes them; `undefined` until the answer arrives. */
export function useTurnstileSettings(): TurnstileSettings | undefined {
  const [settings, setSettings] = useState<TurnstileSettings | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    cached ??= getTurnstileSettings().then((s) => {
      if (s.mode === 'off') cached = null; // re-ask next time: the server may have been down
      return s;
    });
    void cached.then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

/** Test seam: forget the cached settings and script promise. */
export function resetTurnstileCache() {
  cached = null;
  scriptPromise = null;
}

// ---------------------------------------------------------------------------
// The Cloudflare script (window.turnstile)
// ---------------------------------------------------------------------------

export interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  theme: 'light' | 'dark' | 'auto';
  appearance?: 'always' | 'execute' | 'interaction-only';
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': (code?: string) => boolean | void;
  'timeout-callback'?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, opts: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Injects api.js once (only ever called while the mode is on). */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile did not initialise'));
    script.onerror = () => {
      scriptPromise = null; // let a later render try again
      script.remove();
      reject(new Error('The security check could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}
