/**
 * CYBER-002 — Universal demo MFA code satisfies MFA and step-up.
 *
 * Whenever DEMO is enabled (any non-production environment), the shared demo
 * code (DEMO_MFA_CODE, default 246810) is accepted by /api/auth/mfa/totp and
 * /api/auth/step-up for *every* account — even one that has enrolled a real
 * TOTP secret — and the code is published by /api/auth/demo-accounts.
 *
 * This is a universal second-factor / step-up bypass in every non-prod
 * deployment. Exits fail while it reproduces (regression test for the fix:
 * the demo code must not stand in for a real factor, or must be scoped off
 * outside an explicit demo mode).
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Demo MFA code bypasses step-up/MFA',
  area: 'Authentication / MFA',
  run: async (base) => {
    const accts = (await (await fetch(`${base}/api/auth/demo-accounts`)).json()) as {
      enabled: boolean;
      mfaCode: string;
      accounts: any[];
    };
    if (!accts.enabled) return { status: 'skip', id: 'CYBER-002', detail: 'demo disabled' };

    // Real two-step: password sign-in → partial session → MFA with the demo code.
    const email = accts.accounts[2].email as string;
    const step1 = await req(base, 'POST', '/api/auth/sign-in', {
      body: { email, password: 'devhq-demo' },
      origin: 'http://localhost:5173',
      headers: { 'x-devhq-client': 'console' },
    });
    const partial = step1.json?.token;
    const mfa = await req(base, 'POST', '/api/auth/mfa/totp', {
      token: partial,
      origin: 'http://localhost:5173',
      headers: { 'x-devhq-client': 'console' },
      body: { code: accts.mfaCode },
    });
    const mfaBypassed = mfa.status === 200 && !!mfa.json?.ok;

    // Step-up: a verified session re-verifies with the same shared code.
    const verified = await signInDemo(base, 'operations');
    const stepUp = await req(base, 'POST', '/api/auth/step-up', {
      token: verified,
      origin: 'http://localhost:5173',
      body: { code: accts.mfaCode },
    });
    const stepUpBypassed = stepUp.status === 200 && !!stepUp.json?.ok;

    if (mfaBypassed || stepUpBypassed) {
      return {
        status: 'fail',
        id: 'CYBER-002',
        detail: `shared code "${accts.mfaCode}" accepted — MFA=${mfaBypassed} stepUp=${stepUpBypassed} (disclosed by /demo-accounts)`,
      };
    }
    return { status: 'pass', id: 'CYBER-002', detail: 'shared demo code no longer satisfies MFA/step-up' };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
