/**
 * Authentication — IP-based rate-limit bypass via X-Forwarded-For.
 *
 * With TRUST_PROXY unset (the default for a directly-exposed process), the
 * client IP must come from the socket, not from a client-supplied
 * X-Forwarded-For header. Verifies the control: rotate XFF on each request to
 * an auth route; the shared socket-IP bucket must still drain to a 429.
 *
 * Fails if rotating XFF lets the caller sail past the auth limiter (429 never
 * seen within a burst well above the bucket capacity).
 */

import { req, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'XFF rate-limit bypass (TRUST_PROXY unset)',
  area: 'Authentication / DoS',
  run: async (base) => {
    // Fire a concurrent burst (so the bucket can't refill mid-run) at a cheap
    // auth-limited route, each with a distinct spoofed XFF. Dev auth capacity
    // is ~60; with socket-IP keying a burst of 100 must produce several 429s.
    // If XFF were trusted, each distinct XFF would get its own bucket → no 429.
    const BURST = 100;
    const results = await Promise.all(
      Array.from({ length: BURST }, (_, i) =>
        req(base, 'POST', '/api/auth/webauthn/options', {
          origin: 'http://localhost:5173',
          headers: { 'x-forwarded-for': `203.0.113.${i % 254}.${i}` },
        }).then((r) => r.status),
      ),
    );
    const n429 = results.filter((s) => s === 429).length;
    return {
      status: n429 > 0 ? 'pass' : 'fail',
      id: 'INFO-XFF',
      detail:
        n429 > 0
          ? `XFF ignored: single socket-IP bucket drained — ${n429}/${BURST} got 429`
          : `no 429 across ${BURST} spoofed-XFF requests — limiter keyed on attacker-controlled XFF`,
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
