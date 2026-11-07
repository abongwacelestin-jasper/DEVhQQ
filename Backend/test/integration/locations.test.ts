import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAll, type DemoKey } from '../helpers/auth.ts';

interface SignIn {
  id: string;
  memberId: string;
  result: string;
  risk: { score: number };
  location: { countryCode: string };
}

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

describe('locations', () => {
  it('resolves where the caller is (via the trusted proxy header)', async () => {
    const c = app.client({ ip: '91.64.10.10' });
    c.token = (await c.post<{ token: string }>('/api/auth/demo', { role: 'developer' })).json.token;
    const me = await c.get<{ ip: string; location: { city: string } }>('/api/locations/me');
    assert.deepEqual([me.json.ip, me.json.location.city], ['91.64.10.10', 'Berlin']);
  });

  it('looks up IPv4/IPv6 and rejects anything else', async () => {
    const ok = await as.developer.get<{ location: { network: string } }>(
      '/api/locations/lookup?ip=185.220.101.4',
    );
    assert.equal(ok.json.location.network, 'tor');
    assert.equal((await as.developer.get('/api/locations/lookup?ip=::1')).status, 200);
    for (const bad of ['', 'localhost', '1.2.3', '1.2.3.4.5', '<script>'])
      assert.equal(
        (await as.developer.get(`/api/locations/lookup?ip=${encodeURIComponent(bad)}`)).status,
        422,
        bad,
      );
  });

  it('lists known regions', async () => {
    const res = await as.developer.get<{ countryCode: string }[]>('/api/locations/regions');
    assert.ok(res.json.length > 0 && res.json.every((r) => r.countryCode !== 'XX'));
  });

  it('members see only their own sign-in history; admins see everyone and can filter', async () => {
    const mine = await as.developer.get<SignIn[]>('/api/locations/sign-ins?memberId=m1');
    assert.ok(mine.json.length > 0);
    assert.ok(
      mine.json.every((s) => s.memberId === 'm4'),
      'memberId filter ignored for non-admins',
    );
    const admin = await as.admin.get<SignIn[]>('/api/locations/sign-ins?limit=500');
    assert.ok(new Set(admin.json.map((s) => s.memberId)).size > 3);
    const risky = await as.operations.get<SignIn[]>('/api/locations/sign-ins?minRisk=40');
    assert.ok(risky.json.length > 0 && risky.json.every((s) => s.risk.score >= 40));
    const m7 = await as.operations.get<SignIn[]>(
      '/api/locations/sign-ins?memberId=m7&result=blocked',
    );
    assert.ok(
      m7.json.length > 0 && m7.json.every((s) => s.memberId === 'm7' && s.result === 'blocked'),
    );
  });

  it('summary groups by country within the caller’s visibility', async () => {
    const dev = await as.developer.get<{ total: number; countries: { total: number }[] }>(
      '/api/locations/summary',
    );
    const devRows = await as.developer.get<SignIn[]>('/api/locations/sign-ins?limit=500');
    assert.equal(dev.json.total, devRows.json.length);
    assert.equal(
      dev.json.countries.reduce((n, c) => n + c.total, 0),
      dev.json.total,
    );
  });

  it('sessions: own for members, all for Administration:view', async () => {
    const dev = await as.developer.get<{ memberId: string }[]>('/api/locations/sessions');
    assert.ok(dev.json.every((s) => s.memberId === 'm4'));
    const ops = await as.operations.get<{ memberId: string }[]>('/api/locations/sessions');
    assert.ok(new Set(ops.json.map((s) => s.memberId)).size >= 6);
  });

  it('assess is a dry run: it scores but records nothing', async () => {
    const before = (await as.admin.get<SignIn[]>('/api/locations/sign-ins?limit=500')).json.length;
    const res = await as.admin.post<{
      memberId: string;
      decision: string;
      risk: { reasons: string[] };
    }>('/api/locations/assess', { ip: '133.32.1.1', memberId: 'm11' });
    assert.equal(res.status, 200);
    assert.equal(res.json.memberId, 'm11');
    assert.equal(res.json.decision, 'block', JSON.stringify(res.json)); // Lagos 1 h ago → Tokyo
    const after = (await as.admin.get<SignIn[]>('/api/locations/sign-ins?limit=500')).json.length;
    assert.equal(after, before);
  });

  it('assess ignores memberId for non-admins and validates the IP', async () => {
    const res = await as.developer.post<{ memberId: string }>('/api/locations/assess', {
      ip: '1.1.1.1',
      memberId: 'm1',
    });
    assert.equal(res.json.memberId, 'm4');
    assert.equal(
      (await as.developer.post('/api/locations/assess', { ip: 'not-an-ip' })).status,
      422,
    );
    assert.equal(
      (await as.developer.post('/api/locations/assess', { ip: '1.1.1.1', extra: true })).status,
      422,
    );
  });
});
