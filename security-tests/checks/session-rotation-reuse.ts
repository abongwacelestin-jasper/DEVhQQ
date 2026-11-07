/**
 * Authentication — token reuse after rotation, sign-out revocation,
 * and user-agent binding (session theft defence).
 *
 * 1. After a step-up the session token is rotated; the OLD token must be dead.
 * 2. After sign-out the token must be dead.
 * 3. A token presented from a different User-Agent must be revoked.
 *
 * Fails if any pre-rotation / post-sign-out / cross-UA token still authorises.
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Token rotation / sign-out / UA binding',
  area: 'Authentication',
  run: async (base) => {
    const problems: string[] = [];

    // 1. Rotation on step-up.
    const t1 = await signInDemo(base, 'developer');
    const su = await req(base, 'POST', '/api/auth/step-up', {
      token: t1,
      origin: 'http://localhost:5173',
      headers: { 'x-devhq-client': 'console' },
      body: { code: (await (await fetch(`${base}/api/auth/demo-accounts`)).json()).mfaCode },
    });
    const t2 = su.json?.token;
    const oldAfterRotate = await req(base, 'GET', '/api/auth/session', { token: t1 });
    if (oldAfterRotate.status !== 401) problems.push(`old token still valid after rotation (${oldAfterRotate.status})`);
    if (t2) {
      const newWorks = await req(base, 'GET', '/api/auth/session', { token: t2 });
      if (newWorks.status !== 200) problems.push(`rotated token does not work (${newWorks.status})`);
    }

    // 2. Sign-out revokes.
    const t3 = await signInDemo(base, 'tester');
    await req(base, 'POST', '/api/auth/sign-out', { token: t3, origin: 'http://localhost:5173' });
    const afterSignOut = await req(base, 'GET', '/api/auth/session', { token: t3 });
    if (afterSignOut.status !== 401) problems.push(`token valid after sign-out (${afterSignOut.status})`);

    // 3. UA binding: a token minted under UA "A" must die when reused under UA "B".
    const r = await req(base, 'POST', '/api/auth/demo', {
      body: { role: 'designer' },
      origin: 'http://localhost:5173',
      headers: { 'x-devhq-client': 'console' },
      ua: 'Mozilla/5.0 UA-ALPHA',
    });
    const t4 = r.json?.token;
    const crossUa = await req(base, 'GET', '/api/auth/session', {
      token: t4,
      ua: 'Mozilla/5.0 UA-BRAVO',
    });
    if (crossUa.status !== 401) problems.push(`token survived UA change (${crossUa.status})`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-SESS',
      detail: problems.length ? problems.join('; ') : 'rotation, sign-out and UA binding all revoke correctly',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
