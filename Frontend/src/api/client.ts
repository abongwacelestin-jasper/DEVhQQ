/**
 * The one place the web app talks to the API.
 *
 * - Same origin in development (Vite proxies `/api` → the API), so the
 *   `__Host-` session cookie and the server's origin checks behave exactly as
 *   they do in production.
 * - Errors are never swallowed: callers get a typed `ApiError` and decide.
 * - Two server signals are handled centrally because every caller needs them:
 *   `401` with a dead session signs the user out; a step-up challenge opens
 *   re-verification instead of failing silently.
 */

import type { ApiErrorBody } from './types';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/**
 * Browsers on plain http (localhost) may refuse the `Secure` `__Host-` cookie,
 * so we also ask for the token in the response body and send it as a bearer
 * token. Production can drop this by removing the header below and relying on
 * the cookie alone.
 */
export const TOKEN_CLIENT_HEADER = 'X-DevHQ-Client';

const TOKEN_KEY = 'devhq.api.token';
const SESSION_ENDED = new Set([
  'unauthenticated',
  'session_revoked',
  'session_expired',
  'mfa_required',
]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** True when the server says the session is gone rather than merely unauthorized for this action. */
  get isSessionEnded() {
    return this.status === 401 && SESSION_ENDED.has(this.code);
  }
}

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token: string | null = readToken();

export function getToken() {
  return token;
}

export function setToken(next: string | null) {
  token = next;
  try {
    if (next) sessionStorage.setItem(TOKEN_KEY, next);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — the token still works for this page life */
  }
}

type Handlers = {
  signedOut?: () => void;
  stepUpRequired?: () => void;
};

const handlers: Handlers = {};

/**
 * Merges handlers rather than replacing them: AuthProvider owns `signedOut`
 * while ReauthProvider owns `stepUpRequired`, and either may mount first.
 */
export function setAuthHandlers(next: Handlers) {
  Object.assign(handlers, next);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Suppress the automatic sign-out/step-up reactions (used by the auth calls themselves). */
  silent?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    [TOKEN_CLIENT_HEADER]: 'console',
  };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(
      0,
      'network',
      `Couldn't reach the DevHQ API. Is the backend running on :8080?`,
    );
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    const stepUp =
      res.status === 401 &&
      (err?.code === 'step_up_required' || res.headers.get('x-step-up-required') === '1');
    const error = new ApiError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? `HTTP ${res.status}`,
      err?.requestId,
      err?.details,
    );
    if (!opts.silent) {
      if (stepUp) handlers.stepUpRequired?.();
      else if (error.isSessionEnded) handlers.signedOut?.();
    }
    throw error;
  }

  return (body ?? undefined) as T;
}

/** Captures a token the API returned alongside the cookie (see TOKEN_CLIENT_HEADER). */
export function rememberToken(body: { token?: string } | null | undefined) {
  if (body?.token) setToken(body.token);
}
