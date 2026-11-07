/**
 * Client for the internal Python ML service.
 *
 * - Every request is HMAC-signed with ML_SERVICE_TOKEN (see signing.ts).
 * - Hard timeouts: 2 s for predictions, 30 s for the assistant.
 * - Circuit breaker: after 5 consecutive transport failures (timeouts,
 *   network errors, 5xx) calls fail fast for 30 s, then one trial call is let
 *   through. While open, callers use the rule-based heuristics instead, so a
 *   slow or dead ML service never slows the product down.
 *
 * Configuration is read from the environment at call time (ML_SERVICE_URL,
 * ML_SERVICE_TOKEN) so it can be toggled without restarting tests.
 */

import { signedHeaders } from './signing.ts';

export const PREDICT_TIMEOUT_MS = 2_000;
export const ASSISTANT_TIMEOUT_MS = 30_000;
export const TRAIN_TIMEOUT_MS = 180_000;

const FAILURE_THRESHOLD = 5;
const OPEN_MS = 30_000;

export interface MlConfig {
  url: string;
  token: string;
}

export function mlConfig(): MlConfig | null {
  const url = process.env.ML_SERVICE_URL?.trim();
  const token = process.env.ML_SERVICE_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

export type MlFailure =
  | 'unconfigured'
  | 'circuit_open'
  | 'timeout'
  | 'network'
  | 'upstream_error'
  | 'rejected'
  | 'bad_response';

export class MlError extends Error {
  readonly kind: MlFailure;
  readonly status?: number;
  readonly code?: string;

  constructor(kind: MlFailure, message: string, status?: number, code?: string) {
    super(message);
    this.name = 'MlError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const breaker = { failures: 0, openUntil: 0, trialInFlight: false };

export function circuitState(): 'closed' | 'open' | 'half-open' {
  if (breaker.openUntil === 0) return 'closed';
  return Date.now() < breaker.openUntil ? 'open' : 'half-open';
}

/** Test hook: forget past failures. */
export function resetCircuit() {
  breaker.failures = 0;
  breaker.openUntil = 0;
  breaker.trialInFlight = false;
}

function recordSuccess() {
  resetCircuit();
}

function recordFailure() {
  breaker.trialInFlight = false;
  breaker.failures += 1;
  if (breaker.failures >= FAILURE_THRESHOLD || breaker.openUntil !== 0)
    breaker.openUntil = Date.now() + OPEN_MS;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Signed JSON call. Resolves with the parsed body for 2xx; throws MlError
 * otherwise. 4xx and 503 answers (e.g. "model_unavailable") mean the service
 * is up, so they do not count against the breaker.
 */
export async function mlCall(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const cfg = mlConfig();
  if (!cfg) throw new MlError('unconfigured', 'ML_SERVICE_URL / ML_SERVICE_TOKEN not set');
  const state = circuitState();
  if (state === 'open') throw new MlError('circuit_open', 'ML service circuit is open');
  if (state === 'half-open') {
    if (breaker.trialInFlight) throw new MlError('circuit_open', 'ML service trial in flight');
    breaker.trialInFlight = true;
  }

  const payload = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = {
    ...signedHeaders(cfg.token, method, path, payload),
    Accept: 'application/json',
    ...(payload ? { 'Content-Type': 'application/json' } : {}),
  };
  let res: Response;
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers,
      body: payload || undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch (err) {
    recordFailure();
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new MlError('timeout', `ML service did not answer within ${timeoutMs} ms`);
    throw new MlError('network', 'ML service unreachable');
  }

  let parsed: unknown;
  try {
    const text = await res.text();
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    recordFailure();
    throw new MlError('bad_response', 'ML service returned malformed JSON', res.status);
  }

  if (res.ok) {
    recordSuccess();
    return parsed;
  }
  const err = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
  const code = typeof err?.code === 'string' ? err.code : undefined;
  const message = typeof err?.message === 'string' ? err.message : `ML service ${res.status}`;
  if (res.status >= 500 && res.status !== 503) {
    recordFailure();
    throw new MlError('upstream_error', message, res.status, code);
  }
  // Service answered deliberately (validation, auth, model not loaded): it is up.
  breaker.trialInFlight = false;
  throw new MlError('rejected', message, res.status, code);
}
