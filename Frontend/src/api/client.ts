/**
 * The one place the web app talks to the API.
 *
 * - Same origin (Vite proxies `/api` in development; the edge does in
 *   production), so the HttpOnly `__Host-` session cookie is the *only*
 *   credential a browser session uses. No token is ever read from a response
 *   body or written to JS-readable storage.
 * - Errors are never swallowed: callers get a typed `ApiError` and decide.
 * - Two server signals are handled centrally because every caller needs them:
 *   a dead session signs the user out; `401 step_up_required` opens
 *   re-verification and then **retries the original request**, resolving or
 *   rejecting the caller's promise with the retried result.
 * - `403 elevation_required` (a production action without a just-in-time grant)
 *   is announced to the JIT host, which offers to request access for the scope
 *   the server named. It is not retried: a grant needs a second person's approval.
 */

import type { ApiErrorBody } from './types';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/**
 * Codes that mean the session is gone. `mfa_required` is deliberately absent: it means the
 * session is password-only (mid sign-in or enrollment), and data requests fired by providers
 * during that stage must not tear the half-finished sign-in down.
 */
const SESSION_ENDED = new Set([
  'unauthenticated',
  'invalid_token',
  'session_revoked',
  'session_expired',
  'session_context_changed',
  'account_inactive',
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

  /** True when the server wants a fresh strong verification before this action. */
  get isStepUp() {
    return this.status === 401 && this.code === 'step_up_required';
  }

  /** The server refused a production action because no just-in-time grant is active. */
  get isElevationRequired() {
    return this.status === 403 && this.code === 'elevation_required';
  }

  /** The scope the server asked for, e.g. `production:renewberry` (elevation refusals only). */
  get elevationScope(): string | undefined {
    const scope = (this.details as { scope?: unknown } | undefined)?.scope;
    return typeof scope === 'string' ? scope : undefined;
  }

  /** The endpoint is not deployed (yet) or the integration behind it is not configured. */
  get isUnavailable() {
    return (
      this.status === 404 ||
      this.status === 501 ||
      this.status === 503 ||
      this.code === 'integration_unconfigured'
    );
  }
}

type Handlers = {
  signedOut?: () => void;
  /**
   * Opens re-verification for a request the server refused with
   * `step_up_required`. Resolves `true` once the session is verified again,
   * `false` if the person cancelled.
   */
  stepUp?: (cause: ApiError) => Promise<boolean>;
  /** A production action was refused for want of a JIT grant (`error.elevationScope`). */
  elevationRequired?: (cause: ApiError) => void;
};

const handlers: Handlers = {};

/**
 * Merges handlers rather than replacing them: AuthProvider owns `signedOut`,
 * ReauthProvider owns `stepUp` and JitAccessHost owns `elevationRequired`;
 * any may mount first.
 */
export function setAuthHandlers(next: Handlers) {
  Object.assign(handlers, next);
}

/** One re-verification dialog serves every request that is waiting on it. */
let pendingStepUp: Promise<boolean> | null = null;

function awaitStepUp(cause: ApiError, signal?: AbortSignal): Promise<boolean> {
  const handler = handlers.stepUp;
  if (!handler) return Promise.resolve(false);
  pendingStepUp ??= handler(cause).finally(() => {
    pendingStepUp = null;
  });
  const shared = pendingStepUp;
  if (!signal) return shared;
  return new Promise<boolean>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    shared.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Suppress the automatic sign-out/step-up reactions (used by the auth calls themselves). */
  silent?: boolean;
  /** Internal: this attempt is already the retry after a step-up. */
  retried?: boolean;
}

/** Parses a fetch Response into JSON-or-null without throwing. */
export async function readBody(res: Response): Promise<{ text: string; body: unknown }> {
  const text = await res.text();
  if (!text) return { text, body: null };
  try {
    return { text, body: JSON.parse(text) as unknown };
  } catch {
    return { text, body: null };
  }
}

/** Builds the typed error for a non-2xx response. */
export function errorFrom(res: Response, body: unknown): ApiError {
  const err = (body as ApiErrorBody | null)?.error;
  const stepUp =
    res.status === 401 &&
    (err?.code === 'step_up_required' ||
      (!err?.code && res.headers.get('x-step-up-required') === '1'));
  return new ApiError(
    res.status,
    stepUp ? 'step_up_required' : (err?.code ?? `http_${res.status}`),
    err?.message ?? `HTTP ${res.status}`,
    err?.requestId ?? res.headers.get('x-request-id') ?? undefined,
    err?.details,
  );
}

export function networkError(): ApiError {
  return new ApiError(
    0,
    'network',
    `Couldn't reach TavetaHQ. Check your connection and try again.`,
  );
}

/** True when `url` (absolute or relative) targets this page's own origin. */
export function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      // Same-origin only: the session cookie must never ride along to another origin.
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw networkError();
  }

  const { body } = await readBody(res);

  if (!res.ok) {
    const error = errorFrom(res, body);
    if (!opts.silent) {
      if (error.isStepUp && !opts.retried) {
        const verified = await awaitStepUp(error, opts.signal);
        if (verified) return api<T>(path, { ...opts, retried: true });
        throw new ApiError(
          401,
          'step_up_cancelled',
          'Verification was cancelled, so the action was not performed.',
          error.requestId,
        );
      }
      if (error.isSessionEnded) handlers.signedOut?.();
      if (error.isElevationRequired && error.elevationScope) handlers.elevationRequired?.(error);
    }
    throw error;
  }

  return (body ?? undefined) as T;
}
