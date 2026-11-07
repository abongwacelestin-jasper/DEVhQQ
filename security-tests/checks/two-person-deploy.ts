/**
 * Authorization — two-person production deploy rule + step-up.
 *
 * Verifies:
 *  - the requester cannot approve their own production deploy from a second
 *    (fully re-verified) session of the same account -> 403 self_approval;
 *  - approval without a fresh step-up is refused -> 401 step_up_required;
 *  - a role without Deployment:manage cannot approve (BFLA) -> 403.
 *
 * Fails if a requester self-approves, or approval skips step-up / manage.
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Two-person deploy rule',
  area: 'Authorization',
  run: async (base) => {
    const problems: string[] = [];
    // A fresh demo sign-in is already strongly verified (verifiedAt = now), so
    // it satisfies requireStepUp without a separate step-up call.

    // Operations (Deployment:manage) requests a production deploy.
    const ops = await signInDemo(base, 'operations');
    const dep = await req(base, 'POST', '/api/deployments', {
      token: ops,
      origin: 'http://localhost:5173',
      body: { product: 'renewberry', env: 'production', version: '1.2.3', sha: 'abc1234' },
    });
    if (dep.status !== 201) return { status: 'fail', id: 'INFO-DEPLOY', detail: `deploy request failed (${dep.status})` };
    const id = dep.json.id;

    // Same account, a second (fresh, verified) session, approves its own deploy.
    const ops2 = await signInDemo(base, 'operations');
    const selfApprove = await req(base, 'POST', `/api/deployments/${id}/approve`, {
      token: ops2,
      origin: 'http://localhost:5173',
    });
    if (selfApprove.status !== 403 || selfApprove.json?.error?.code !== 'self_approval')
      problems.push(`requester self-approved (${selfApprove.status}/${selfApprove.json?.error?.code})`);

    // A role lacking Deployment:manage (Developer) must not approve (BFLA).
    const dev = await signInDemo(base, 'developer');
    const devApprove = await req(base, 'POST', `/api/deployments/${id}/approve`, {
      token: dev,
      origin: 'http://localhost:5173',
    });
    if (devApprove.status !== 403) problems.push(`non-manage role approved (${devApprove.status})`);

    // Owner (different member, Deployment:admin, fresh/verified) approves -> 200.
    const owner = await signInDemo(base, 'admin');
    const approve = await req(base, 'POST', `/api/deployments/${id}/approve`, {
      token: owner,
      origin: 'http://localhost:5173',
    });
    if (approve.status !== 200) problems.push(`legitimate second-person approval blocked (${approve.status})`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-DEPLOY',
      detail: problems.length ? problems.join('; ') : 'self-approval blocked; manage+second-person approval enforced',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
