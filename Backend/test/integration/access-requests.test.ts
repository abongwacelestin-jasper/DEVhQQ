/** "Request access" from the web app's no-access page. */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAll, type DemoKey } from '../helpers/auth.ts';

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

describe('team — access requests from the no-access page', () => {
  it('audits the request and notifies the members who manage the team', async () => {
    const res = await as.developer.post<{ requested: string; notified: number }>(
      '/api/access/requests',
      { path: '/audit', reason: 'incident review' },
    );
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.requested, '/audit');
    assert.ok(res.json.notified >= 1, 'at least the Owner');
    const inbox = await as.admin.get<{ items: { title: string; link: string }[] }>(
      '/api/notifications',
    );
    const n = inbox.json.items.find((i) => i.title.includes('requested access to /audit'));
    assert.ok(n, 'the Owner sees it');
    assert.equal(n.link, '/team/m4');
    const trail = await as.admin.get<{ target: string }[]>('/api/audit?action=access.requested');
    assert.ok(trail.json.some((e) => e.target.startsWith('/audit')));
    // A Developer does not manage the team, so is never notified.
    const devInbox = await as.developer.get('/api/notifications');
    assert.ok(!devInbox.text.includes('requested access'));
  });

  it('refuses paths that are not in-app paths', async () => {
    const res = await as.developer.post('/api/access/requests', { path: 'https://evil.example' });
    assert.equal(res.status, 422);
  });
});
