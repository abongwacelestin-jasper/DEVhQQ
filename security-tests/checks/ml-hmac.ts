/**
 * ML bridge — HMAC request signing contract (WAVE4 §6 ML).
 *
 * Exercises the shared verifier (`Backend/integrations/ml/signing.ts`, kept in
 * lockstep with the Python service's `hmac_auth.py`). Verifies, against the
 * real implementation with an injected clock:
 *  - a correctly signed request is accepted (null);
 *  - missing signature/timestamp/nonce → unauthenticated;
 *  - a tampered body or wrong token → bad_signature (constant-time compare);
 *  - a timestamp outside the 5-minute skew → signature_expired;
 *  - a replayed (timestamp, nonce) pair → replayed.
 *
 * Fails if any unsigned, tampered, stale or replayed request would be accepted.
 */

import type { Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';
import {
  MAX_SKEW_SECONDS,
  sign,
  signedHeaders,
  verifySignature,
} from '../../Backend/integrations/ml/signing.ts';

export const check: Check = {
  name: 'ML bridge HMAC (replay / skew / unsigned)',
  area: 'ML / SSRF',
  run: async () => {
    const token = 'ml-test-token-0123456789';
    const method = 'POST';
    const path = '/v1/predict/overdue';
    const body = JSON.stringify({ taskKey: 'RB-1' });
    const now = 1_000_000_000_000; // fixed clock
    const problems: string[] = [];

    const h = signedHeaders(token, method, path, body, now);
    const hdr = (x: Record<string, string>) => ({
      signature: x['X-DevHQ-Signature'],
      timestamp: x['X-DevHQ-Timestamp'],
      nonce: x['X-DevHQ-Nonce'],
    });

    // Valid.
    if (verifySignature(token, hdr(h), method, path, body, now) !== null)
      problems.push('a correctly signed request was rejected');

    // Unsigned.
    if (verifySignature(token, {}, method, path, body, now) !== 'unauthenticated')
      problems.push('unsigned request not rejected as unauthenticated');

    // Tampered body (fresh nonce to isolate from replay).
    const h2 = signedHeaders(token, method, path, body, now);
    if (verifySignature(token, hdr(h2), method, path, '{"taskKey":"RB-999"}', now) !== 'bad_signature')
      problems.push('tampered body not rejected');

    // Wrong token.
    const h3 = signedHeaders(token, method, path, body, now);
    if (verifySignature('other-token', hdr(h3), method, path, body, now) !== 'bad_signature')
      problems.push('wrong signing key accepted');

    // Expired (just beyond the skew window).
    const stale = {
      signature: sign(token, String(Math.floor(now / 1000) - MAX_SKEW_SECONDS - 5), 'abc', method, path, body),
      timestamp: String(Math.floor(now / 1000) - MAX_SKEW_SECONDS - 5),
      nonce: 'abc',
    };
    if (verifySignature(token, stale, method, path, body, now) !== 'signature_expired')
      problems.push('stale timestamp beyond skew not rejected');

    // Replay: same (timestamp, nonce) accepted once, refused the second time.
    const h4 = signedHeaders(token, method, path, body, now);
    const first = verifySignature(token, hdr(h4), method, path, body, now);
    const second = verifySignature(token, hdr(h4), method, path, body, now);
    if (first !== null || second !== 'replayed')
      problems.push(`replay not blocked (first=${first}, second=${second})`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-MLHMAC',
      detail: problems.length
        ? problems.join('; ')
        : 'valid accepted; unsigned/tampered/wrong-key/stale/replayed all refused (5-min skew, nonce cache)',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
