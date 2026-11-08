/** Wave 5 assessment regressions: W5-04 (PATs on password change), W5-05, W5-06. */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { fullSignIn, signInAs } from '../helpers/auth.ts';

let app: TestServer;
before(async () => {
  app = await startApp();
});
after(() => app.close());

describe('W5-04 — a password change ends personal access tokens too', () => {
  it('a PAT issued before the change stops working', async () => {
    const c: Client = await fullSignIn(app, 'sam@techorg.io'); // m8
    const pat = await c.post<{ token: string }>('/api/tokens', {
      name: 'w5-04',
      scopes: ['project:view'],
      expiresInDays: 7,
    });
    assert.equal(pat.status, 201, pat.text);
    const viaPat = app.client();
    viaPat.token = pat.json.token;
    assert.equal((await viaPat.get('/api/tasks')).status, 200, 'works before');
    const changed = await c.post('/api/auth/password', {
      currentPassword: 'devhq-demo',
      newPassword: 'W5-04-Changed-Passw0rd!',
    });
    assert.ok(changed.status < 300, changed.text);
    assert.equal((await viaPat.get('/api/tasks')).status, 401, 'revoked after');
  });
});

describe('W5-05 — incident owners must be in scope', () => {
  it('an owner outside the product (or unknown) is refused', async () => {
    const tester = await signInAs(app, 'tester'); // renewberry + mirror
    for (const owner of ['m-nobody', 'm4']) {
      // m4 (Developer) is on RenewBerry only, so not a valid owner for a Mirror incident.
      const res = await tester.post('/api/incidents', {
        product: 'mirror',
        title: 'W5-05 owner check',
        severity: 'SEV3',
        owner,
      });
      assert.equal(res.status, 422, `${owner}: ${res.text}`);
      assert.equal(errorCode(res), 'invalid_owner');
    }
  });
});

describe('W5-06 — access requests cannot flood the admins', () => {
  it('rejects free-text paths and limits each member to 5 per hour', async () => {
    const dev = await signInAs(app, 'developer');
    for (const path of ['/audit please click http://evil.example', '/a/b/c/d/e/f', 'audit'])
      assert.equal((await dev.post('/api/access/requests', { path })).status, 422, path);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++)
      statuses.push((await dev.post('/api/access/requests', { path: `/w5-area-${i}` })).status);
    assert.deepEqual(statuses.slice(0, 2), [200, 200]);
    assert.equal(statuses.at(-1), 429, JSON.stringify(statuses));
  });
});

describe('W5-07 — two Owners demoting each other at once', () => {
  it('leaves at least one active Owner', async () => {
    const amara = await signInAs(app, 'admin'); // m1, Owner
    const promote = await amara.patch('/api/team/m3', { role: 'Owner' });
    assert.equal(promote.status, 200, promote.text);
    const priya = await fullSignIn(app, 'priya@techorg.io'); // m3, now Owner
    const [a, b] = await Promise.all([
      amara.patch('/api/team/m3', { role: 'Developer' }),
      priya.patch('/api/team/m1', { role: 'Developer' }),
    ]);
    const ok = [a.status, b.status].filter((s) => s === 200).length;
    assert.ok(ok <= 1, `both demotions succeeded: ${a.status} ${b.status}`);
    const team = await (await signInAs(app, 'admin')).get<{ role: string; status: string }[]>(
      '/api/team',
    );
    const owners = (Array.isArray(team.json) ? team.json : []).filter(
      (m) => m.role === 'Owner' && m.status === 'active',
    );
    assert.ok(owners.length >= 1, 'the workspace kept an Owner');
  });
});
