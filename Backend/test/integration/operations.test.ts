import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { forceStepUp, signInAll, stepUp, type DemoKey } from '../helpers/auth.ts';
import { grantAccess, revokeAccess } from '../helpers/jit.ts';

interface Deployment {
  id: string;
  product: string;
  env: string;
  status: string;
  requestedBy: string;
  approvedBy?: string;
  provider: string;
}
interface Incident {
  id: string;
  product: string;
  status: string;
  severity: string;
  owner: string;
  resolvedAt?: string;
  timeline: { by: string; note: string }[];
}

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

const deploy = (over: Record<string, unknown> = {}) => ({
  product: 'renewberry',
  env: 'production',
  version: 'v9.9.9',
  sha: 'abcdef1',
  ...over,
});

describe('operations — deployments (two-person rule)', () => {
  it('staging runs immediately; production waits for approval', async () => {
    const staging = await as.operations.post<Deployment>(
      '/api/deployments',
      deploy({ env: 'staging' }),
    );
    assert.equal(staging.status, 201);
    assert.equal(staging.json.status, 'running');
    assert.equal(staging.json.provider, 'GitHub Actions');
    const prod = await as.operations.post<Deployment>('/api/deployments', deploy());
    assert.equal(prod.json.status, 'awaiting-approval');
  });

  it('the requester can never approve their own deployment', async () => {
    const { json: d } = await as.operations.post<Deployment>('/api/deployments', deploy());
    const self = await as.operations.post(`/api/deployments/${d.id}/approve`);
    assert.equal(self.status, 403);
    assert.equal(errorCode(self), 'self_approval');
    const other = await as.admin.post<Deployment>(`/api/deployments/${d.id}/approve`);
    assert.equal(other.status, 200);
    assert.deepEqual([other.json.status, other.json.approvedBy], ['running', 'm1']);
    const twice = await as.admin.post(`/api/deployments/${d.id}/approve`);
    assert.equal(twice.status, 409);
  });

  it('approval demands a fresh step-up', async () => {
    const { json: d } = await as.admin.post<Deployment>('/api/deployments', deploy());
    const ops = as.operations;
    // Production approval also needs a JIT grant (jit-enforcement.test.ts); hold one so
    // this test isolates the step-up requirement.
    const grant = await grantAccess(ops, as.admin, 'production:renewberry');
    await forceStepUp(ops, '127.200.0.1');
    const res = await ops.post(`/api/deployments/${d.id}/approve`);
    assert.equal(res.status, 401);
    assert.equal(errorCode(res), 'step_up_required');
    await stepUp(ops);
    assert.equal((await ops.post(`/api/deployments/${d.id}/approve`)).status, 200);
    await revokeAccess(as.admin, grant.id);
  });

  it('rollback is allowed without step-up (MTTR first) but only once', async () => {
    const { json: d } = await as.admin.post<Deployment>(
      '/api/deployments',
      deploy({ env: 'staging' }),
    );
    const first = await as.operations.post<Deployment>(`/api/deployments/${d.id}/rollback`);
    assert.equal(first.json.status, 'rolled-back');
    assert.equal((await as.operations.post(`/api/deployments/${d.id}/rollback`)).status, 409);
  });

  it('validates version and sha formats', async () => {
    for (const over of [
      { sha: 'XYZ' },
      { sha: 'abc' },
      { version: 'v1 beta' },
      { env: 'dev' },
      { product: 'other' },
    ])
      assert.equal(
        (await as.operations.post('/api/deployments', deploy(over))).status,
        422,
        JSON.stringify(over),
      );
  });

  it('filters by product/env/status, newest first', async () => {
    const res = await as.admin.get<Deployment[]>('/api/deployments?product=blog&env=production');
    assert.ok(res.json.length > 0);
    assert.ok(res.json.every((d) => d.product === 'blog' && d.env === 'production'));
    const all = await as.admin.get<{ createdAt: string }[]>('/api/deployments');
    const times = all.json.map((d) => d.createdAt);
    assert.deepEqual(times, [...times].sort().reverse());
  });
});

describe('operations — incidents', () => {
  it('declare → update → resolve, with a timeline entry per change', async () => {
    const res = await as.developer.post<Incident>('/api/incidents', {
      product: 'renewberry',
      title: 'Checkout latency',
      severity: 'SEV2',
    });
    assert.equal(res.status, 201);
    const id = res.json.id;
    assert.match(id, /^INC-\d+$/);
    assert.equal(res.json.owner, 'm4');
    // Raising severity and closing a SEV1 are production decisions: both need a JIT grant
    // (refusals are covered in jit-enforcement.test.ts).
    const devGrant = await grantAccess(as.developer, as.operations, 'production:renewberry');
    const opsGrant = await grantAccess(as.operations, as.admin, 'production:renewberry');
    const sev = await as.developer.patch<Incident>(`/api/incidents/${id}`, {
      severity: 'SEV1',
      note: 'Paging on-call',
    });
    assert.equal(sev.json.timeline.at(-1)?.note, 'Severity → SEV1 · Paging on-call');
    const resolved = await as.operations.patch<Incident>(`/api/incidents/${id.toLowerCase()}`, {
      status: 'resolved',
    });
    assert.equal(resolved.json.status, 'resolved');
    assert.ok(resolved.json.resolvedAt);
    const noop = await as.operations.patch(`/api/incidents/${id}`, { status: 'resolved' });
    assert.equal(noop.status, 422);
    assert.equal(errorCode(noop), 'no_change');
    await revokeAccess(as.admin, devGrant.id);
    await revokeAccess(as.admin, opsGrant.id);
  });

  it('cannot declare an incident for a product outside scope', async () => {
    const res = await as.developer.post('/api/incidents', {
      product: 'blog',
      title: 'Not mine',
      severity: 'SEV3',
    });
    assert.equal(res.status, 404);
  });

  it('stats summarise open incidents and MTTR within scope', async () => {
    const stats = await as.admin.get<{
      open: number;
      resolved: number;
      mttrMinutes: number | null;
      bySeverity: Record<string, number>;
    }>('/api/incidents/_stats');
    assert.equal(stats.status, 200);
    const list = await as.admin.get<Incident[]>('/api/incidents');
    assert.equal(stats.json.open, list.json.filter((i) => i.status !== 'resolved').length);
    assert.deepEqual(Object.keys(stats.json.bySeverity), ['SEV1', 'SEV2', 'SEV3']);
    const pmStats = await as.pm.get<{ open: number }>('/api/incidents/_stats');
    const pmList = await as.pm.get<Incident[]>('/api/incidents');
    assert.equal(pmStats.json.open, pmList.json.filter((i) => i.status !== 'resolved').length);
  });
});
