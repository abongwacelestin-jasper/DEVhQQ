/**
 * JIT enforcement: production-impacting actions need an approved, unexpired
 * grant for `production:<product>`; the Owner passes; tokens never do.
 *
 * Guarded (routes/operations.routes.ts):
 *   POST  /api/deployments/:id/approve   (production)
 *   POST  /api/deployments/:id/rollback  (production, once approved or running)
 *   PATCH /api/incidents/:id             (severity change, or resolving a SEV1)
 */
import '../setup.ts';
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAll, type DemoKey } from '../helpers/auth.ts';
import { grantAccess, revokeAccess, type TestGrant } from '../helpers/jit.ts';
import { expireDueGrants, listGrants } from '../../auth/jit.ts';

interface Deployment {
  id: string;
  status: string;
  approvedBy?: string;
}
interface Incident {
  id: string;
  status: string;
  severity: string;
}
interface AuditRow {
  actor: string;
  action: string;
  target: string;
  sensitive: boolean;
  requestId?: string;
}
interface ErrorBody {
  error: { code: string; details?: { scope?: string } };
}

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

/** Every test starts with nobody elevated. */
afterEach(async () => {
  for (const g of listGrants())
    if (g.status === 'active' || g.status === 'pending') await revokeAccess(as.admin, g.id);
});

const sha = () =>
  Array.from({ length: 7 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** A production deploy requested by `by`, awaiting approval. */
async function pendingDeploy(by: Client, product = 'renewberry'): Promise<Deployment> {
  const res = await by.post<Deployment>('/api/deployments', {
    product,
    env: 'production',
    version: 'v1.0.0',
    sha: sha(),
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.status, 'awaiting-approval');
  return res.json;
}

/** A production deploy that the Owner approved, so it is live (running). */
async function liveDeploy(product = 'renewberry'): Promise<Deployment> {
  const d = await pendingDeploy(as.operations, product);
  const ok = await as.admin.post<Deployment>(`/api/deployments/${d.id}/approve`);
  assert.equal(ok.status, 200, ok.text);
  return ok.json;
}

function assertElevationRequired(res: { status: number; json: unknown }, scope: string) {
  assert.equal(res.status, 403, JSON.stringify(res.json));
  const body = res.json as ErrorBody;
  assert.equal(body.error.code, 'elevation_required');
  assert.equal(body.error.details?.scope, scope, 'the refusal names the scope to request');
}

async function auditOf(action: string): Promise<AuditRow[]> {
  const res = await as.admin.get<AuditRow[]>(`/api/audit?action=${action}&limit=500`);
  assert.equal(res.status, 200, res.text);
  return res.json;
}

describe('JIT — production deployment approval', () => {
  it('without a grant: 403 elevation_required with the scope, and nothing changes', async () => {
    const d = await pendingDeploy(as.admin);
    const res = await as.operations.post(`/api/deployments/${d.id}/approve`);
    assertElevationRequired(res, 'production:renewberry');
    const list = await as.admin.get<Deployment[]>('/api/deployments');
    assert.equal(list.json.find((x) => x.id === d.id)?.status, 'awaiting-approval');
  });

  it('with an approved grant: 200, and the use is audited as sensitive jit.used', async () => {
    const d = await pendingDeploy(as.admin);
    const grant = await grantAccess(as.operations, as.admin, 'production:renewberry');
    const res = await as.operations.post<Deployment>(`/api/deployments/${d.id}/approve`);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.json.status, res.json.approvedBy], ['running', 'm11']);
    const used = (await auditOf('jit.used')).find((e) => e.target.includes(d.id));
    assert.ok(used, 'jit.used entry written');
    assert.equal(used.actor, 'm11');
    assert.equal(used.sensitive, true);
    assert.ok(used.requestId, 'carries the request id');
    assert.match(used.target, new RegExp(`production:renewberry · deploy\\.approve ${d.id}`));
    assert.ok(used.target.includes(`grant ${grant.id}`), 'names the grant that was used');
  });

  it('a grant for another product does not unlock this one', async () => {
    const d = await pendingDeploy(as.admin);
    await grantAccess(as.operations, as.admin, 'production:blog');
    assertElevationRequired(
      await as.operations.post(`/api/deployments/${d.id}/approve`),
      'production:renewberry',
    );
  });

  it('a pending (not yet approved) grant does not unlock anything', async () => {
    const d = await pendingDeploy(as.admin);
    const req = await as.operations.post<TestGrant>('/api/access/grants', {
      scope: 'production:renewberry',
      reason: 'Waiting on a second approver',
      durationMinutes: 30,
    });
    assert.equal(req.json.status, 'pending');
    assertElevationRequired(
      await as.operations.post(`/api/deployments/${d.id}/approve`),
      'production:renewberry',
    );
  });

  it('an expired grant: 403 on the very next request, before the sweeper runs', async () => {
    const d = await pendingDeploy(as.admin);
    const grant = await grantAccess(as.operations, as.admin, 'production:renewberry');
    // Time-box elapses (the stored grant is the live object).
    const stored = listGrants().find((g) => g.id === grant.id)!;
    stored.expiresAt = Date.now() - 1;
    assert.equal(stored.status, 'active', 'sweeper has not marked it yet');
    assertElevationRequired(
      await as.operations.post(`/api/deployments/${d.id}/approve`),
      'production:renewberry',
    );
    const caps = await as.operations.get<{ elevations: string[] }>('/api/me/capabilities');
    assert.deepEqual(caps.json.elevations, []);
    // The sweeper then records it.
    assert.ok(expireDueGrants() >= 1);
    assert.equal(stored.status, 'expired');
    assert.ok(
      (await auditOf('jit.expired')).some((e) => e.target.includes('production:renewberry')),
    );
  });

  it('a revoked grant: 403 immediately on the same live session', async () => {
    const first = await pendingDeploy(as.admin);
    const second = await pendingDeploy(as.admin);
    const grant = await grantAccess(as.operations, as.admin, 'production:renewberry');
    assert.equal((await as.operations.post(`/api/deployments/${first.id}/approve`)).status, 200);
    await revokeAccess(as.admin, grant.id);
    // Same session, no sign-in again: the next request is refused.
    assertElevationRequired(
      await as.operations.post(`/api/deployments/${second.id}/approve`),
      'production:renewberry',
    );
  });

  it('the Owner approves without a grant, and no jit.used is recorded for it', async () => {
    const d = await pendingDeploy(as.operations);
    const res = await as.admin.post<Deployment>(`/api/deployments/${d.id}/approve`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.approvedBy, 'm1');
    assert.ok(!(await auditOf('jit.used')).some((e) => e.target.includes(d.id)));
  });

  it('role, existence and the two-person rule are checked before the elevation', async () => {
    const d = await pendingDeploy(as.admin);
    // No Deployment:manage → forbidden, never a misleading "request access".
    assert.equal(
      errorCode(await as.developer.post(`/api/deployments/${d.id}/approve`)),
      'forbidden',
    );
    assert.equal((await as.operations.post('/api/deployments/d-nope/approve')).status, 404);
    const own = await pendingDeploy(as.operations);
    assert.equal(
      errorCode(await as.operations.post(`/api/deployments/${own.id}/approve`)),
      'self_approval',
    );
  });
});

describe('JIT — production rollback', () => {
  it('rolling back a live production deploy needs a grant', async () => {
    const d = await liveDeploy();
    assertElevationRequired(
      await as.operations.post(`/api/deployments/${d.id}/rollback`),
      'production:renewberry',
    );
    await grantAccess(as.operations, as.admin, 'production:renewberry');
    const ok = await as.operations.post<Deployment>(`/api/deployments/${d.id}/rollback`);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.status, 'rolled-back');
    assert.ok(
      (await auditOf('jit.used')).some((e) => e.target.includes(`deploy.rollback ${d.id}`)),
    );
  });

  it('the Owner rolls back production without a grant', async () => {
    const d = await liveDeploy('mirror');
    assert.equal((await as.admin.post(`/api/deployments/${d.id}/rollback`)).status, 200);
  });

  it('rejecting a production deploy that never ran needs no grant', async () => {
    const d = await pendingDeploy(as.admin);
    const res = await as.operations.post<Deployment>(`/api/deployments/${d.id}/rollback`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.status, 'rolled-back');
  });
});

describe('JIT — staging is unaffected', () => {
  it('staging deploys run and roll back without any grant', async () => {
    const res = await as.operations.post<Deployment>('/api/deployments', {
      product: 'renewberry',
      env: 'staging',
      version: 'v1.0.1',
      sha: sha(),
    });
    assert.equal(res.json.status, 'running');
    const rb = await as.operations.post<Deployment>(`/api/deployments/${res.json.id}/rollback`);
    assert.equal(rb.status, 200, rb.text);
    assert.equal(rb.json.status, 'rolled-back');
    // A staging deploy never awaits approval: 409, not an elevation refusal.
    const other = await as.operations.post<Deployment>('/api/deployments', {
      product: 'renewberry',
      env: 'staging',
      version: 'v1.0.2',
      sha: sha(),
    });
    assert.equal(
      errorCode(await as.admin.post(`/api/deployments/${other.json.id}/approve`)),
      'not_pending',
    );
  });
});

describe('JIT — incidents', () => {
  async function declare(severity: 'SEV1' | 'SEV2'): Promise<Incident> {
    const res = await as.developer.post<Incident>('/api/incidents', {
      product: 'renewberry',
      title: `JIT check ${severity}`,
      severity,
    });
    assert.equal(res.status, 201, res.text);
    return res.json;
  }

  it('changing severity needs a grant; notes and status moves do not', async () => {
    const i = await declare('SEV2');
    assertElevationRequired(
      await as.developer.patch(`/api/incidents/${i.id}`, { severity: 'SEV1' }),
      'production:renewberry',
    );
    const note = await as.developer.patch<Incident>(`/api/incidents/${i.id}`, {
      status: 'identified',
      note: 'Found the bad config',
      severity: 'SEV2', // unchanged severity is not a change
    });
    assert.equal(note.status, 200, note.text);
    await grantAccess(as.developer, as.operations, 'production:renewberry');
    const sev = await as.developer.patch<Incident>(`/api/incidents/${i.id}`, { severity: 'SEV1' });
    assert.equal(sev.status, 200, sev.text);
    assert.equal(sev.json.severity, 'SEV1');
  });

  it('resolving a SEV1 needs a grant; resolving a SEV2 does not', async () => {
    const sev1 = await declare('SEV1');
    assertElevationRequired(
      await as.developer.patch(`/api/incidents/${sev1.id}`, { status: 'resolved' }),
      'production:renewberry',
    );
    const stillOpen = await as.developer.get<Incident>(`/api/incidents/${sev1.id}`);
    assert.equal(stillOpen.json.status, 'investigating');
    assert.equal(
      (await as.developer.patch(`/api/incidents/${sev1.id}`, { status: 'monitoring' })).status,
      200,
    );
    // The Owner closes it without a grant.
    assert.equal(
      (await as.admin.patch(`/api/incidents/${sev1.id}`, { status: 'resolved' })).status,
      200,
    );
    const sev2 = await declare('SEV2');
    assert.equal(
      (await as.developer.patch(`/api/incidents/${sev2.id}`, { status: 'resolved' })).status,
      200,
    );
  });

  it('an incident outside the caller’s products stays 404', async () => {
    const res = await as.developer.patch('/api/incidents/INC-32', { severity: 'SEV1' });
    assert.equal(res.status, 404);
  });
});

describe('JIT — personal access tokens', () => {
  async function issuePat(c: Client, scopes: string[]): Promise<string> {
    const res = await c.post<{ token: string }>('/api/tokens', {
      name: 'jit-check',
      scopes,
      expiresInDays: 7,
    });
    assert.equal(res.status, 201, res.text);
    return res.json.token;
  }

  it('a token never carries its owner’s elevation and is refused production actions', async () => {
    await grantAccess(as.operations, as.admin, 'production:renewberry');
    const token = await issuePat(as.operations, ['deployment:manage', 'organization:view']);
    const pat = app.client({ token });
    const caps = await pat.get<{ elevations: string[] }>('/api/me/capabilities');
    assert.equal(caps.status, 200, caps.text);
    assert.deepEqual(caps.json.elevations, [], 'the session holds the grant, the token does not');
    const d = await liveDeploy();
    const res = await pat.post<ErrorBody>(`/api/deployments/${d.id}/rollback`);
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'elevation_unavailable');
    assert.equal(res.json.error.details?.scope, 'production:renewberry');
    // The same member's session, holding the grant, can.
    assert.equal((await as.operations.post(`/api/deployments/${d.id}/rollback`)).status, 200);
  });

  it('not even an Owner token with organization:admin bypasses it; staging still works', async () => {
    const token = await issuePat(as.admin, ['organization:admin', 'deployment:admin']);
    const pat = app.client({ token });
    const d = await liveDeploy('blog');
    const res = await pat.post(`/api/deployments/${d.id}/rollback`);
    assert.equal(res.status, 403);
    assert.equal(errorCode(res), 'elevation_unavailable');
    const staging = await pat.post<Deployment>('/api/deployments', {
      product: 'blog',
      env: 'staging',
      version: 'v2.0.0',
      sha: sha(),
    });
    assert.equal(staging.status, 201, staging.text);
    assert.equal((await pat.post(`/api/deployments/${staging.json.id}/rollback`)).status, 200);
  });
});

describe('JIT — requester view and approver notice', () => {
  it('GET /api/access/grants/mine lists only the caller’s grants', async () => {
    await grantAccess(as.developer, as.operations, 'production:renewberry', 15);
    const mine = await as.developer.get<TestGrant[]>('/api/access/grants/mine');
    assert.equal(mine.status, 200, mine.text);
    assert.ok(mine.json.length >= 1);
    assert.ok(mine.json.every((g) => g.memberId === 'm4'));
    assert.equal(mine.json[0].status, 'active');
    assert.ok(mine.json[0].expiresAt! > Date.now());
    // The full list stays Administration-only.
    assert.equal((await as.developer.get('/api/access/grants')).status, 403);
  });

  it('a request notifies approvers with a link to where they approve', async () => {
    const req = await as.tester.post<TestGrant>('/api/access/grants', {
      scope: 'production:mirror',
      reason: 'Verify the mirror rollout fix',
      durationMinutes: 15,
    });
    assert.equal(req.status, 200, req.text);
    const inbox = await as.operations.get<{
      items: { title: string; link: string; kind: string }[];
    }>('/api/notifications');
    assert.equal(inbox.status, 200, inbox.text);
    const n = inbox.json.items.find((x) => x.title.includes('production:mirror'));
    assert.ok(n, 'Operations is told');
    assert.deepEqual([n.kind, n.link], ['approval', '/security']);
  });
});
