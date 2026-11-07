/**
 * Authorization — personal access token (PAT) authority (SEC C-09/C-10/C-11).
 *
 * Verifies:
 *  1. Scope-above-role refused at creation (a PM cannot mint Administration:admin).
 *  2. Scope caps authority: a PAT whose scope omits an area the role allows is
 *     still refused on that area (effectiveLevel = min(role, scope)).
 *  3. A PAT can never satisfy step-up (403 step_up_unavailable).
 *  4. A PAT can never manage tokens (create/list/revoke) — session-only.
 *  5. Expiry is required and bounded (≤ 90 d); unbounded expiry refused.
 *
 * Fails if a PAT exceeds its role/scope, passes step-up, or manages tokens.
 */

import { CLI, req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

async function stepUp(base: string, token: string): Promise<string> {
  const code = (await (await fetch(`${base}/api/auth/demo-accounts`)).json()).mfaCode;
  const r = await req(base, 'POST', '/api/auth/step-up', { token, headers: CLI, body: { code } });
  return r.json?.token ?? token;
}

export const check: Check = {
  name: 'PAT authority (scope/step-up/management)',
  area: 'Authorization',
  run: async (base) => {
    const problems: string[] = [];

    // A PM session (fresh demo = verified) creates PATs.
    const pm = await stepUp(base, await signInDemo(base, 'pm'));

    // (1) Scope above role: PM has no Administration:admin → refuse.
    const over = await req(base, 'POST', '/api/tokens', {
      token: pm,
      headers: CLI,
      body: { name: 'over', scopes: ['administration:admin'], expiresInDays: 30 },
    });
    if (over.status !== 422) problems.push(`scope-above-role PAT created (${over.status})`);

    // (5) Unbounded / over-max expiry refused.
    const longExp = await req(base, 'POST', '/api/tokens', {
      token: pm,
      headers: CLI,
      body: { name: 'long', scopes: ['product:view'], expiresInDays: 3650 },
    });
    if (longExp.status !== 422) problems.push(`expiry >90d accepted (${longExp.status})`);

    // Create a legitimate, deliberately narrow PAT: product:view only.
    const mk = await req(base, 'POST', '/api/tokens', {
      token: pm,
      headers: CLI,
      body: { name: 'narrow', scopes: ['product:view'], expiresInDays: 7 },
    });
    if (mk.status !== 201 || !mk.json?.token)
      return { status: 'fail', id: 'INFO-PAT', detail: `legit PAT creation failed (${mk.status} ${mk.text})` };
    const pat = mk.json.token as string;

    // (2) Scope cap: the PM role allows Deployment:view, but this PAT's scope is
    // product:view only, so effectiveLevel(Deployment) = none. The PM *session*
    // can read deployments; the narrow PAT must be refused (403).
    const sessionCan = await req(base, 'GET', '/api/deployments', { token: pm, headers: CLI });
    const patCapped = await req(base, 'GET', '/api/deployments', { token: pat });
    if (sessionCan.status !== 200)
      problems.push(`PM session unexpectedly refused on Deployment (${sessionCan.status})`);
    if (patCapped.status !== 403)
      problems.push(`PAT read a Deployment area outside its scope (${patCapped.status})`);

    // (3) PAT cannot step up (needed for sensitive actions). The step-up route is
    // session-only, so a PAT is refused with 403 (session_required or
    // step_up_unavailable) — either way it can never gain a fresh verification.
    const su = await req(base, 'POST', '/api/auth/step-up', { token: pat, body: { code: '000000' } });
    const suBlocked =
      su.status === 403 &&
      ['step_up_unavailable', 'session_required'].includes(su.json?.error?.code);
    if (!suBlocked) problems.push(`PAT step-up not blocked (${su.status}/${su.json?.error?.code})`);

    // (4) PAT cannot manage tokens (session-only).
    const list = await req(base, 'GET', '/api/tokens', { token: pat });
    if (list.status !== 403) problems.push(`PAT listed tokens (${list.status})`);
    const mint = await req(base, 'POST', '/api/tokens', {
      token: pat,
      body: { name: 'x', scopes: ['product:view'], expiresInDays: 7 },
    });
    if (mint.status !== 403) problems.push(`PAT minted a token (${mint.status})`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-PAT',
      detail: problems.length
        ? problems.join('; ')
        : 'scope-above-role 422; scope caps authority; PAT cannot step-up or manage tokens; expiry bounded',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
