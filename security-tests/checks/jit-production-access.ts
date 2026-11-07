/**
 * Authorization — just-in-time production access (SEC C-11).
 *
 * Verifies, against a live server:
 *  1. Operations (Deployment:manage, fresh step-up) cannot approve a production
 *     deploy without a grant -> 403 elevation_required naming the scope;
 *  2. the requester cannot approve their own grant (two-person rule);
 *  3. a personal access token never carries the elevation its owner holds
 *     -> 403 elevation_unavailable on a production rollback;
 *  4. once approved, the session can act; once revoked, the same live
 *     session is refused on its next request (no sign-out needed).
 *
 * Fails if any production-impacting action passes without a live grant.
 */

import { CLI, req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

const ORIGIN = 'http://localhost:5173';

export const check: Check = {
  name: 'JIT production access enforced',
  area: 'Authorization',
  run: async (base) => {
    const problems: string[] = [];
    const owner = await signInDemo(base, 'admin');
    const ops = await signInDemo(base, 'operations');
    const deploy = async () =>
      (
        await req(base, 'POST', '/api/deployments', {
          token: owner,
          origin: ORIGIN,
          body: { product: 'renewberry', env: 'production', version: 'jit-1', sha: 'abc1234' },
        })
      ).json?.id as string;

    // (1) No grant.
    const d1 = await deploy();
    const none = await req(base, 'POST', `/api/deployments/${d1}/approve`, { token: ops, origin: ORIGIN });
    if (none.status !== 403 || none.json?.error?.code !== 'elevation_required')
      problems.push(`approved without a grant (${none.status}/${none.json?.error?.code})`);
    else if (none.json?.error?.details?.scope !== 'production:renewberry')
      problems.push('refusal does not name the scope');

    // (2) Request, then try to approve it yourself.
    const grant = await req(base, 'POST', '/api/access/grants', {
      token: ops,
      origin: ORIGIN,
      body: { scope: 'production:renewberry', reason: 'security check: approve a release', durationMinutes: 15 },
    });
    if (grant.status !== 200) return { status: 'fail', id: 'INFO-JIT', detail: `grant request failed (${grant.status})` };
    const self = await req(base, 'POST', `/api/access/grants/${grant.json.id}/approve`, { token: ops, origin: ORIGIN });
    if (self.status !== 403) problems.push(`requester approved their own grant (${self.status})`);
    const ok = await req(base, 'POST', `/api/access/grants/${grant.json.id}/approve`, { token: owner, origin: ORIGIN });
    if (ok.status !== 200) return { status: 'fail', id: 'INFO-JIT', detail: `owner approval failed (${ok.status})` };

    // (3) A token of the elevated member.
    const mk = await req(base, 'POST', '/api/tokens', {
      token: ops,
      headers: CLI,
      body: { name: 'jit', scopes: ['deployment:manage'], expiresInDays: 1 },
    });
    if (mk.status === 201) {
      const live = await deploy();
      // The Owner requested `live`, so the elevated Operations session approves it (now running).
      await req(base, 'POST', `/api/deployments/${live}/approve`, { token: ops, origin: ORIGIN });
      const viaPat = await req(base, 'POST', `/api/deployments/${live}/rollback`, { token: mk.json.token });
      if (viaPat.status !== 403 || viaPat.json?.error?.code !== 'elevation_unavailable')
        problems.push(`PAT used its owner's elevation (${viaPat.status}/${viaPat.json?.error?.code})`);
    } else problems.push(`could not mint a PAT for the check (${mk.status})`);

    // (4) Elevated session acts; revoke; the same session is refused at once.
    const approve = await req(base, 'POST', `/api/deployments/${d1}/approve`, { token: ops, origin: ORIGIN });
    if (approve.status !== 200) problems.push(`approved grant did not unlock approval (${approve.status})`);
    await req(base, 'POST', `/api/access/grants/${grant.json.id}/revoke`, { token: owner, origin: ORIGIN });
    const d2 = await deploy();
    const after = await req(base, 'POST', `/api/deployments/${d2}/approve`, { token: ops, origin: ORIGIN });
    if (after.status !== 403 || after.json?.error?.code !== 'elevation_required')
      problems.push(`revoked grant still worked (${after.status})`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-JIT',
      detail: problems.length
        ? problems.join('; ')
        : 'no grant → 403 elevation_required; self-approval refused; PAT never elevated; revoke immediate',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
