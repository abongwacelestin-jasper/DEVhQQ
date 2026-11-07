/** GET /api/offboarding: the whole queue for Administration:view, only your own otherwise. */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAll, stepUp, type DemoKey } from '../helpers/auth.ts';

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

type List = { items: { memberId: string }[] };

describe('offboarding list scope', () => {
  it('a Developer sees only their own offboarding; admins see everyone', async () => {
    await stepUp(as.admin);
    const started = await as.admin.post('/api/offboarding/m8', {
      lastDay: '2026-12-31',
      reason: 'Scope test',
      handoverTo: 'm6',
    });
    assert.ok(started.status < 300, started.text);
    const admin = await as.admin.get<List>('/api/offboarding');
    assert.equal(admin.status, 200);
    assert.ok(admin.json.items.some((r) => r.memberId === 'm8'));
    const dev = await as.developer.get<List>('/api/offboarding');
    assert.equal(dev.status, 200);
    assert.ok(dev.json.items.every((r) => r.memberId === 'm4'), JSON.stringify(dev.json));
  });
});
