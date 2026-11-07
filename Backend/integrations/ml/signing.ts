/**
 * HMAC request signing shared with the Python ML service
 * (Models/devhq_models/security/hmac_auth.py — keep the two in lockstep).
 *
 * Canonical string, `\n`-joined: `v1`, unix seconds, nonce, METHOD,
 * path (with ?query), raw body. Header `X-DevHQ-Signature: v1=<hex>` plus
 * `X-DevHQ-Timestamp` and `X-DevHQ-Nonce`. Five-minute skew, constant-time
 * comparison, and a nonce cache so a captured request can't be replayed.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const MAX_SKEW_SECONDS = 300;

export function canonical(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  body: string,
): string {
  return ['v1', timestamp, nonce, method.toUpperCase(), path].join('\n') + '\n' + body;
}

export function sign(
  token: string,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  body = '',
): string {
  const mac = createHmac('sha256', token)
    .update(canonical(timestamp, nonce, method, path, body), 'utf8')
    .digest('hex');
  return `v1=${mac}`;
}

export function signedHeaders(
  token: string,
  method: string,
  path: string,
  body = '',
  now = Date.now(),
): Record<string, string> {
  const ts = String(Math.floor(now / 1000));
  const nonce = randomBytes(16).toString('hex');
  return {
    'X-DevHQ-Timestamp': ts,
    'X-DevHQ-Nonce': nonce,
    'X-DevHQ-Signature': sign(token, ts, nonce, method, path, body),
  };
}

const seen = new Map<string, number>();

/** Verifies an inbound signed request. Returns an error code, or null when valid. */
export function verifySignature(
  token: string,
  headers: { signature?: string; timestamp?: string; nonce?: string },
  method: string,
  path: string,
  body: string,
  now = Date.now(),
): string | null {
  const { signature, timestamp, nonce } = headers;
  if (!signature || !timestamp || !nonce) return 'unauthenticated';
  if (!/^\d{1,12}$/.test(timestamp) || nonce.length > 64) return 'unauthenticated';
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return 'signature_expired';
  const expected = Buffer.from(sign(token, timestamp, nonce, method, path, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'bad_signature';
  for (const [k, at] of seen) if (now - at > 2 * MAX_SKEW_SECONDS * 1000) seen.delete(k);
  const key = `${timestamp}:${nonce}`;
  if (seen.has(key)) return 'replayed';
  seen.set(key, now);
  return null;
}
