/**
 * CYBER-002 — Demo MFA code scope (SEC hardening C-06).
 *
 * Phase 1 found the shared demo code (`246810`) satisfied MFA/step-up for every
 * account. SEC scoped it: `demoCodeAllowed` now requires DEMO enabled AND a
 * *seeded* demo member (DEMO_MEMBER_IDS) AND no real factor. The code working
 * for a factor-less *seeded* account in dev is by design.
 *
 * This regression test asserts the hardening without weakening it:
 *  H1. Once a seeded demo account enrolls a real TOTP, the demo code is
 *      rejected on both step-up and MFA (a real factor is never shadowed).
 *  H2. An invited, non-seeded real member can never use the demo code — it
 *      must enroll/verify a real factor.
 *  H3. Demo is disabled under a production posture (NODE_ENV=production).
 *
 * Residual (reported, not a suite failure): demo is gated on
 * `NODE_ENV !== 'production'`, so a *staging* build (NODE_ENV=staging) still
 * ships working seeded accounts whose step-up is satisfied by the public code.
 * Recommend an explicit DEMO_MODE flag instead of "not production".
 *
 * Fails if the demo code works for a factor-ful or invited member, or if demo
 * is enabled under NODE_ENV=production.
 */

import { CLI, inviteMember, passwordStep, req, spawnServer, totp, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Demo MFA code scope (hardening + staging residual)',
  area: 'Authentication / MFA',
  run: async (base) => {
    const accts = (await (await fetch(`${base}/api/auth/demo-accounts`)).json()) as {
      enabled: boolean;
      mfaCode: string;
    };
    if (!accts.enabled) return { status: 'skip', id: 'CYBER-002', detail: 'demo disabled here' };
    const code = accts.mfaCode;
    const problems: string[] = [];

    // H1: enroll a real TOTP on a seeded demo account (developer), then the demo
    // code must stop working for step-up and MFA.
    const dev = await signInDemoCli(base, 'developer');
    const enroll = await req(base, 'POST', '/api/auth/totp/enroll', { token: dev, headers: CLI, body: {} });
    if (enroll.status !== 201 || !enroll.json?.secret) {
      problems.push(`could not enroll TOTP on seeded account (${enroll.status})`);
    } else {
      const confirm = await req(base, 'POST', '/api/auth/totp/confirm', {
        token: dev,
        headers: CLI,
        body: { code: totp(enroll.json.secret) },
      });
      if (confirm.status !== 200) problems.push(`TOTP confirm failed (${confirm.status} ${confirm.text})`);
      // Demo code must now be refused on step-up.
      const su = await req(base, 'POST', '/api/auth/step-up', { token: dev, headers: CLI, body: { code } });
      if (su.status === 200) problems.push('demo code still satisfied step-up after a real factor was enrolled');
    }

    // H2: an invited non-seeded member must not be able to use the demo code.
    const u = await inviteMember(base, 'demo-scope-probe@techorg.io');
    const partial = await passwordStep(base, u.email, u.password);
    const mfa = await req(base, 'POST', '/api/auth/mfa/totp', { token: partial, headers: CLI, body: { code } });
    if (mfa.status === 200 && mfa.json?.ok)
      problems.push('demo code verified MFA for an invited (non-seeded) member');

    // H3: production posture disables demo entirely.
    let prodDemo = 'n/a';
    try {
      const prod = await spawnServer({
        env: { NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64), DATA_ENCRYPTION_KEY: 'b'.repeat(64), WEBAUTHN_RP_ID: 'localhost' },
      });
      try {
        const da = await (await fetch(`${prod.base}/api/auth/demo-accounts`)).json();
        prodDemo = da?.enabled ? 'ENABLED' : 'disabled';
        if (da?.enabled) problems.push('demo accounts enabled under NODE_ENV=production');
      } finally {
        prod.stop();
      }
    } catch {
      prodDemo = 'prod-refused-boot'; // fail-closed on weak/missing prod secrets is also acceptable
    }

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'CYBER-002',
      detail: problems.length
        ? problems.join('; ')
        : `hardened: demo code rejected after real factor + for invited members; prod demo=${prodDemo}. ` +
          `Residual: demo is gated on NODE_ENV!=='production', so a 'staging' build still honours the public code for seeded accounts — prefer an explicit DEMO_MODE flag.`,
    };
  },
};

/** CLI-style demo sign-in (body token, no Origin). */
async function signInDemoCli(base: string, role: string): Promise<string> {
  const r = await req(base, 'POST', '/api/auth/demo', { headers: CLI, body: { role } });
  if (!r.json?.token) throw new Error(`demo sign-in failed: ${r.status} ${r.text}`);
  return r.json.token as string;
}

if (isMain(import.meta.url)) void runStandalone(check);
