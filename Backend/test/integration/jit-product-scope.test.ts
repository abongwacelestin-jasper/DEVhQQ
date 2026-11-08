/**
 * W5-02: JIT grants are product-scoped for approvers too. An approver who cannot
 * see the grant's product does not see it listed, and gets 404 on approve/revoke,
 * so they cannot satisfy the two-person rule for someone else's product.
 */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAs } from '../helpers/auth.ts';

let app: TestServer;
let admin: Client;
let dev: Client;
let ops: Client;

before(async () => {
  app = await startApp();
  admin = await signInAs(app, 'admin');
  // Narrow Operations (m11) to Blog; the privilege change ends their sessions.
  const narrowed = await admin.patch('/api/team/m11', { products: ['blog'] });
  assert.equal(narrowed.status, 200, narrowed.text);
  ops = await signInAs(app, 'operations');
  dev = await signInAs(app, 'developer'); // m4, RenewBerry
});
after(() => app.close());

describe('JIT grants — approver product scope', () => {
  it('an approver outside the product cannot see, approve or revoke the grant', async () => {
    const req = await dev.post<{ id: string; status: string }>('/api/access/grants', {
      scope: 'production:renewberry',
      reason: 'W5-02 regression: rollout check',
      durationMinutes: 30,
    });
    assert.equal(req.status, 200, req.text);

    const list = await ops.get<{ id: string }[]>('/api/access/grants');
    assert.equal(list.status, 200);
    assert.ok(!list.json.some((g) => g.id === req.json.id), 'not listed outside its product');

    const approve = await ops.post(`/api/access/grants/${req.json.id}/approve`);
    assert.equal(approve.status, 404, approve.text);
    assert.equal(errorCode(approve), 'not_found');

    const revoke = await ops.post(`/api/access/grants/${req.json.id}/revoke`);
    assert.equal(revoke.status, 404, revoke.text);

    // The Owner, who sees every product, still can approve it.
    const ownerList = await admin.get<{ id: string }[]>('/api/access/grants');
    assert.ok(ownerList.json.some((g) => g.id === req.json.id));
    const ok = await admin.post<{ status: string }>(`/api/access/grants/${req.json.id}/approve`);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.status, 'active');
  });
});
