/**
 * Authentication — MFA stage confusion / partial-session escalation.
 *
 * A password-only (partial) session must only reach the MFA endpoints. It must
 * NOT be able to call verified routes. Verifies that a partial session is
 * rejected (401 mfa_required) on a protected route, and that the partial token
 * cannot approve deploys, change teams, or read the session as if verified.
 *
 * Fails if a partial session reaches any verified-only route.
 */

import { req, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Partial-session (pre-MFA) cannot reach verified routes',
  area: 'Authentication',
  run: async (base) => {
    const accts = await (await fetch(`${base}/api/auth/demo-accounts`)).json();
    const email = accts.accounts[2].email as string;
    const step1 = await req(base, 'POST', '/api/auth/sign-in', {
      body: { email, password: 'devhq-demo' },
      headers: { 'x-devhq-client': 'cli' },
    });
    const partial = step1.json?.token;
    if (!partial) return { status: 'fail', id: 'INFO-PARTIAL', detail: 'no partial token from password step' };

    const problems: string[] = [];
    const protectedRoutes: [string, string][] = [
      ['GET', '/api/auth/session'],
      ['GET', '/api/_query/collections'],
      ['GET', '/api/team'],
      ['POST', '/api/deployments'],
    ];
    for (const [m, p] of protectedRoutes) {
      const r = await req(base, m, p, { token: partial, origin: 'http://localhost:5173', body: m === 'POST' ? {} : undefined });
      if (r.status !== 401) problems.push(`${m} ${p} reachable with partial session (${r.status})`);
    }
    // The /pending route IS allowed for a partial session (expected 200).
    const pending = await req(base, 'GET', '/api/auth/pending', { token: partial });
    if (pending.status !== 200) problems.push(`/api/auth/pending unexpectedly ${pending.status}`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-PARTIAL',
      detail: problems.length ? problems.join('; ') : 'partial session limited to MFA routes only',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
