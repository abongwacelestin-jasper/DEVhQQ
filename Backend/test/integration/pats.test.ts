/** Personal access tokens over HTTP: issue (step-up, shown once), use, scope limits, revoke. */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { forceStepUp, signInAs } from '../helpers/auth.ts';

let app: TestServer;
let owner: Client;
let dev: Client;

before(async () => {
  app = await startApp();
  owner = await signInAs(app, 'admin');
  dev = await signInAs(app, 'developer');
});
after(() => app.close());

async function issue(c: Client, scopes: string[], name = 'ci') {
  const res = await c.post<{ id: string; token: string; scopes: string[] }>('/api/tokens', {
    name,
    scopes,
    expiresInDays: 7,
  });
  assert.equal(res.status, 201, res.text);
  return res.json;
}

/** A client that authenticates with a PAT (own IP, no session). */
const patClient = (token: string) => app.client({ token });

describe('PATs — lifecycle', () => {
  it('is shown once, listed without the secret, and works as a bearer token', async () => {
    const t = await issue(dev, ['project:view']);
    assert.match(t.token, /^dhq_pat_/);
    const list = await dev.get<{ items: Record<string, unknown>[] }>('/api/tokens');
    assert.equal(list.status, 200);
    assert.ok(!list.text.includes(t.token), 'secret never listed');
    assert.ok(list.json.items.some((x) => x.id === t.id));
    const tasks = await patClient(t.token).get<{ items: { product: string }[] }>('/api/tasks');
    assert.equal(tasks.status, 200, tasks.text);
    assert.ok(tasks.json.items.every((x) => x.product === 'renewberry'));
  });

  it('scopes cap the role: a view-only token cannot write', async () => {
    const t = await issue(dev, ['project:view']);
    const res = await patClient(t.token).post('/api/tasks', {});
    assert.equal(res.status, 403);
    assert.equal(errorCode(res), 'forbidden');
  });

  it('cannot request scopes above the role', async () => {
    const res = await dev.post('/api/tokens', {
      name: 'x',
      scopes: ['deployment:manage'],
      expiresInDays: 7,
    });
    assert.equal(res.status, 422);
    assert.equal(errorCode(res), 'scope_exceeds_role');
  });

  it('validates name, scopes and expiry', async () => {
    for (const body of [
      { name: 'x', scopes: [], expiresInDays: 7 },
      { name: 'x', scopes: ['project:root'], expiresInDays: 7 },
      { name: 'x', scopes: ['project:view'], expiresInDays: 0 },
      { name: 'x', scopes: ['project:view'], expiresInDays: 91 },
      { name: '', scopes: ['project:view'], expiresInDays: 7 },
      { name: 'x', scopes: ['project:view'] },
    ])
      assert.equal((await dev.post('/api/tokens', body)).status, 422, JSON.stringify(body));
  });

  it('issuing needs a fresh step-up', async () => {
    const c = await signInAs(app, 'tester');
    await forceStepUp(c, '127.77.0.1');
    const res = await c.post('/api/tokens', {
      name: 'x',
      scopes: ['project:view'],
      expiresInDays: 7,
    });
    assert.equal(res.status, 401);
    assert.equal(errorCode(res), 'step_up_required');
  });

  it('a PAT cannot manage tokens, step up or reach session-only routes', async () => {
    const t = await issue(dev, ['project:view', 'organization:view']);
    const p = patClient(t.token);
    assert.equal(
      (await p.post('/api/tokens', { name: 'y', scopes: ['project:view'], expiresInDays: 7 }))
        .status,
      403,
    );
    assert.equal((await p.get('/api/tokens')).status, 403);
    assert.equal((await p.get('/api/auth/passkeys')).status, 403);
  });

  it('revocation takes effect immediately; tampered tokens fail', async () => {
    const t = await issue(dev, ['project:view']);
    assert.equal((await patClient(`${t.token}x`).get('/api/tasks')).status, 401);
    assert.equal((await dev.delete(`/api/tokens/${t.id}`)).status, 204);
    const after = await patClient(t.token).get('/api/tasks');
    assert.equal(after.status, 401);
  });
});

describe('PATs — Owner shortcuts honour token scope', () => {
  // FINDING B-8 (auth/rbac.ts:150, routes/docs.routes.ts:37 and the same
  // `p.role === 'Owner'` check in routes/{assistant,doc-collab,system}.routes.ts):
  // rbac.ts:142 documents that Owner-only shortcuts honour PAT scope (a
  // token needs organization:admin for them) and hasOwnerPowers() implements
  // that, but canSeeProduct() and the restricted-doc check still test the raw
  // role. An Owner's narrowly-scoped token (e.g. project:view for a CI job)
  // can read restricted docs it is not an editor of, and products the Owner is
  // not assigned to.
  it(
    'an Owner token without organization:admin cannot read restricted docs it does not edit',
    { todo: 'FINDING B-8: raw role check bypasses PAT scope for Owner shortcuts' },
    async () => {
      const t = await issue(owner, ['project:view'], 'ci-docs');
      const res = await patClient(t.token).get('/api/docs/doc-api-runbook');
      assert.equal(res.status, 404, res.text);
    },
  );

  it('the same Owner token with organization:admin keeps the shortcut', async () => {
    const t = await issue(owner, ['project:view', 'organization:admin'], 'admin-docs');
    assert.equal((await patClient(t.token).get('/api/docs/doc-api-runbook')).status, 200);
  });
});
