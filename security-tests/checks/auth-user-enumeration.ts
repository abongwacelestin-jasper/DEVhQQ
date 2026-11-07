/**
 * Authentication — user enumeration via status / body / timing.
 *
 * Verifies the control holds: an unknown email and a known email with the
 * wrong password must return an identical response (status + code + message)
 * and indistinguishable timing. The server equalises timing by running a
 * dummy scrypt for unknown accounts.
 *
 * Fails if the two paths differ in status/body (a reliable enumeration oracle),
 * or if the timing medians diverge by more than a conservative factor.
 */

import { demoAccounts, median, req, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

async function timeSignIn(base: string, email: string, password: string) {
  const t0 = performance.now();
  const r = await req(base, 'POST', '/api/auth/sign-in', {
    body: { email, password },
    origin: 'http://localhost:5173',
  });
  return { ms: performance.now() - t0, status: r.status, code: r.json?.error?.code, msg: r.json?.error?.message };
}

export const check: Check = {
  name: 'User enumeration (status/body/timing)',
  area: 'Authentication',
  run: async (base) => {
    const accts = await demoAccounts(base);
    const known = accts.accounts[0].email as string;
    const unknown = 'does-not-exist-9f2a@techorg.io';

    const a = await timeSignIn(base, known, 'wrong-password-xyz');
    const b = await timeSignIn(base, unknown, 'wrong-password-xyz');

    if (a.status !== b.status || a.code !== b.code || a.msg !== b.msg) {
      return {
        status: 'fail',
        id: 'INFO-ENUM',
        detail: `response differs: known=${a.status}/${a.code} unknown=${b.status}/${b.code}`,
      };
    }

    // Timing: spread known-account probes across ALL demo accounts, max 4 hits
    // each, so the 5-failure lockout never trips and skews the measurement.
    const knownEmails = accts.accounts.map((x: any) => x.email as string);
    const knownT: number[] = [];
    const unknownT: number[] = [];
    for (let round = 0; round < 4; round++) {
      for (const e of knownEmails) knownT.push((await timeSignIn(base, e, `pw${round}`)).ms);
      for (let i = 0; i < knownEmails.length; i++)
        unknownT.push((await timeSignIn(base, `ghost${round}-${i}@techorg.io`, `pw${round}`)).ms);
    }
    const mk = median(knownT);
    const mu = median(unknownT);
    const ratio = Math.max(mk, mu) / Math.max(1, Math.min(mk, mu));
    const timingLeak = ratio > 3; // conservative; equalised paths sit near 1.0
    return {
      status: timingLeak ? 'fail' : 'pass',
      id: 'INFO-ENUM',
      detail: `identical ${a.status}/${a.code}; timing median known=${mk.toFixed(1)}ms unknown=${mu.toFixed(1)}ms (ratio ${ratio.toFixed(2)})`,
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
