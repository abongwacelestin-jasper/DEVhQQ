import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { forceStepUp, signInAll, stepUp, type DemoKey } from '../helpers/auth.ts';

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

interface Entry {
  seq: number;
  actor: string;
  action: string;
  sensitive: boolean;
  hash: string;
}

describe('security — audit trail', () => {
  it('records sign-ins and is newest first; filters by actor, action and sensitivity', async () => {
    const all = await as.admin.get<Entry[]>('/api/audit?limit=500');
    assert.equal(all.status, 200);
    const seqs = all.json.map((e) => e.seq);
    assert.deepEqual(
      seqs,
      [...seqs].sort((a, b) => b - a),
    );
    assert.ok(all.json.some((e) => e.action === 'auth.demo_sign_in' && e.actor === 'm4'));
    const mine = await as.admin.get<Entry[]>('/api/audit?actor=m4&action=auth.');
    assert.ok(
      mine.json.length > 0 &&
        mine.json.every((e) => e.actor === 'm4' && e.action.startsWith('auth.')),
    );
    const sensitive = await as.admin.get<Entry[]>('/api/audit?sensitive=1');
    assert.ok(sensitive.json.every((e) => e.sensitive));
    assert.equal((await as.admin.get<Entry[]>('/api/audit?limit=3')).json.length, 3);
  });

  it('the hash chain verifies and readiness reports it intact', async () => {
    assert.deepEqual((await as.admin.get('/api/audit/verify')).json, { ok: true });
    const ready = await app.client().get<{ ready: boolean; auditChain: string }>('/api/ready');
    assert.deepEqual(
      [ready.status, ready.json.ready, ready.json.auditChain],
      [200, true, 'intact'],
    );
  });
});

describe('security — console reads need Administration:view', () => {
  it('a Developer is refused the trail, its verification, posture, rate limits and backups', async () => {
    for (const path of [
      '/api/audit',
      '/api/audit/verify',
      '/api/security/posture',
      '/api/security/rate-limits',
      '/api/backups',
    ])
      assert.equal((await as.developer.get(path)).status, 403, path);
  });

  it('Operations (Administration:view) can read the trail', async () => {
    assert.equal((await as.operations.get('/api/audit?limit=5')).status, 200);
  });
});

describe('security — posture and rate limits', () => {
  it('reports identity, WAAP, zero-trust, crypto and resilience sections', async () => {
    const res =
      await as.admin.get<Record<string, Record<string, unknown>>>('/api/security/posture');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json).sort(), [
      'crypto',
      'identity',
      'resilience',
      'waap',
      'zeroTrust',
    ]);
    assert.ok((res.json.identity.liveSessions as number) >= 6);
    assert.ok((res.json.waap.routesInventoried as number) > 50);
    assert.deepEqual(res.json.resilience.audit, { ok: true });
  });

  it('the API limiter returns 429 with Retry-After once a client’s bucket is empty', async () => {
    const c = app.client();
    let limited: Awaited<ReturnType<Client['get']>> | undefined;
    // Dev/test limits: 600-token bucket refilling at 20/s. Burst well past it.
    for (let i = 0; i < 1200 && !limited; i += 50) {
      const batch = await Promise.all(Array.from({ length: 50 }, () => c.get('/api/health')));
      limited = batch.find((r) => r.status === 429);
    }
    assert.ok(limited, 'expected a 429');
    assert.equal(errorCode(limited), 'rate_limited');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    // Another client (different IP) is unaffected.
    assert.equal((await app.client().get('/api/health')).status, 200);
    const stats = await as.admin.get<{ key: string; tokens: number }[]>(
      '/api/security/rate-limits',
    );
    assert.ok(stats.json.some((s) => s.key === `api:ip:${c.ip}` && s.tokens === 0));
  });

  it('the auth limiter is much tighter than the API limiter', async () => {
    const c = app.client();
    let status = 0;
    let n = 0;
    // 60-token bucket at 1/s in dev. Use a cheap auth route (no password hashing).
    while (status !== 429 && n < 120) {
      status = (await c.post('/api/auth/webauthn/options')).status;
      n++;
    }
    assert.equal(status, 429);
    assert.ok(n > 50 && n <= 70, `limited after ${n} requests`);
  });
});

describe('security — backups (step-up protected)', () => {
  it('Owner creates a snapshot and runs a restore drill', async () => {
    const created = await as.admin.post<{ file: string; sha256: string }>('/api/backups');
    assert.equal(created.status, 201, created.text);
    assert.match(created.json.sha256, /^[0-9a-f]{64}$/);
    const status = await as.admin.get<{ latest?: { sha256: string } }>('/api/backups');
    assert.equal(status.json.latest?.sha256, created.json.sha256);
    const drill = await as.admin.post<{ ok: boolean }>('/api/backups/drill');
    assert.equal(drill.status, 200);
    assert.equal(drill.json.ok, true);
  });

  it('requires a fresh step-up', async () => {
    const ops = as.operations;
    await forceStepUp(ops, '127.250.0.9');
    const res = await ops.post('/api/backups');
    assert.equal(res.status, 401);
    assert.equal(errorCode(res), 'step_up_required');
    await stepUp(ops);
    assert.equal((await ops.post('/api/backups')).status, 201);
  });
});

describe('security — response headers and origin guard', () => {
  it('sets hardening headers on every response, including errors', async () => {
    for (const path of ['/api/health', '/api/does-not-exist']) {
      const res = await app.client().get(path);
      const h = res.headers;
      // JSON API responses carry a deny-all CSP (nothing in them is rendered).
      const csp = h.get('content-security-policy') ?? '';
      assert.match(csp, /default-src 'none'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(h.get('x-content-type-options'), 'nosniff');
      assert.equal(h.get('x-frame-options'), 'DENY');
      assert.equal(h.get('cache-control'), 'no-store');
      assert.equal(h.get('cross-origin-opener-policy'), 'same-origin');
      assert.equal(h.get('x-powered-by'), null);
    }
  });

  it('blocks state-changing requests from foreign origins but allows the app origin', async () => {
    const evil = await app
      .client()
      .post('/api/auth/demo', { role: 'admin' }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.equal(errorCode(evil), 'bad_origin');
    const good = await app
      .client()
      .post('/api/auth/demo', { role: 'admin' }, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(good.headers.get('access-control-allow-credentials'), 'true');
    // GETs from foreign origins are not blocked, but get no CORS grant.
    const read = await app
      .client()
      .get('/api/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('access-control-allow-origin'), null);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await app
      .client()
      .request('OPTIONS', '/api/tasks', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(ok.status, 204);
    assert.match(ok.headers.get('access-control-allow-methods') ?? '', /PATCH/);
    const bad = await app
      .client()
      .request('OPTIONS', '/api/tasks', { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.status, 403);
  });
});
