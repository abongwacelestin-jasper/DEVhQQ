import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAs } from '../helpers/auth.ts';

let app: TestServer;
let dev: Client;
let admin: Client;
before(async () => {
  app = await startApp();
  dev = await signInAs(app, 'developer');
  admin = await signInAs(app, 'admin');
});
after(() => app.close());

describe('system — probes and discovery', () => {
  it('health, ready, version and status codes are public', async () => {
    const c = app.client();
    assert.equal((await c.get<{ ok: boolean }>('/api/health')).json.ok, true);
    assert.equal((await c.get<{ ready: boolean }>('/api/ready')).json.ready, true);
    assert.equal((await c.get<{ env: string }>('/api/version')).json.env, 'test');
    assert.equal(
      (await c.get<Record<string, string>>('/api/_status-codes')).json['429'],
      'Too Many Requests',
    );
  });

  it('OpenAPI lists every inventoried route with path params and security', async () => {
    const spec = await app.client().get<{
      openapi: string;
      paths: Record<
        string,
        Record<string, { security: unknown[]; parameters: { name: string }[] }>
      >;
    }>('/api/openapi.json');
    assert.equal(spec.json.openapi, '3.1.0');
    const inv = await dev.get<{ method: string; path: string; auth: string }[]>('/api/_inventory');
    for (const r of inv.json) {
      const op = spec.json.paths[r.path.replace(/:([a-zA-Z]+)/g, '{$1}')]?.[r.method.toLowerCase()];
      assert.ok(op, `${r.method} ${r.path} missing from OpenAPI`);
      assert.equal(op.security.length === 0, r.auth === 'public', `${r.method} ${r.path} security`);
      assert.deepEqual(
        op.parameters.map((p) => p.name),
        [...r.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1]),
      );
    }
  });

  it('config is redacted (secrets reported as set/unset only)', async () => {
    const cfg = await admin.get<{ secrets: Record<string, string> }>('/api/_config');
    assert.equal(cfg.status, 200);
    assert.ok(!cfg.text.includes('dev-only-secret'));
    for (const v of Object.values(cfg.json.secrets))
      assert.match(v, /^(set|not set|dev fallback|\d+ key\(s\))$/, 'presence or a count only');
  });

  it('metrics are exposed as JSON and Prometheus text', async () => {
    assert.equal((await admin.get('/api/_metrics')).status, 200);
    const prom = await admin.get('/api/_metrics?format=prometheus');
    assert.equal(prom.status, 200);
    assert.match(prom.headers.get('content-type') ?? '', /^text\/plain/);
  });

  it('logs redact secrets', async () => {
    const logs = await admin.get('/api/_logs?limit=500');
    assert.equal(logs.status, 200);
    assert.ok(!logs.text.includes('devhq-demo'), 'demo password never logged');
  });

  it('config, metrics and logs need Administration:view', async () => {
    for (const path of ['/api/_config', '/api/_metrics', '/api/_logs']) {
      const res = await dev.get(path);
      assert.equal(res.status, 403, path);
      assert.equal(errorCode(res), 'forbidden', path);
    }
  });

  it('unknown routes 404 and wrong methods 405', async () => {
    assert.equal((await app.client().get('/api/nope')).status, 404);
    const res = await app.client().request('DELETE', '/api/health');
    assert.equal(res.status, 405);
    assert.equal(errorCode(res), 'method_not_allowed');
  });

  it('serves the console with a nonce CSP and redirects / to it', async () => {
    const page = await app.client().get('/console');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'nonce-[^']+'/);
    const root = await fetch(`${app.base}/`, { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/console');
  });

  it('serves allow-listed fonts only (no traversal)', async () => {
    const font = await app.client().get('/fonts/inter-latin.woff2');
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    for (const bad of ['..%2Fpackage.json', 'x.ttf', 'Inter.woff2', '..%2F..%2Fserver.ts'])
      assert.equal((await app.client().get(`/fonts/${bad}`)).status, 404, bad);
  });
});

describe('system — query runner', () => {
  it('runs allow-listed queries and audits them', async () => {
    const res = await dev.post<{ total: number; rows: { key: string; priority: string }[] }>(
      '/api/_query',
      {
        from: 'tasks',
        where: { priority: { in: ['urgent', 'high'] } },
        select: ['key', 'priority'],
        orderBy: { field: 'key', dir: 'desc' },
      },
    );
    assert.equal(res.status, 200);
    assert.ok(res.json.rows.every((r) => ['urgent', 'high'].includes(r.priority)));
    const audit = await admin.get<{ action: string }[]>('/api/audit?action=console.query');
    assert.ok(audit.json.length > 0);
  });

  it('the audit collection is empty for callers without Administration:view', async () => {
    const q = { from: 'audit', select: ['seq', 'action'] };
    assert.equal((await dev.post<{ total: number }>('/api/_query', q)).json.total, 0);
    assert.ok((await admin.post<{ total: number }>('/api/_query', q)).json.total > 0);
  });

  it('refuses secrets, unknown collections, nested conditions and bad bounds', async () => {
    const bad: unknown[] = [
      { from: 'members', select: ['passwordHash'] },
      { from: 'members', where: { totpSecret: { exists: true } } },
      { from: 'sessions' },
      { from: 'tasks', where: { status: { in: [{ $ne: 1 }] } } },
      { from: 'tasks', where: { status: { eq: { nested: true } } } },
      { from: 'tasks', where: [] },
      { from: 'tasks', limit: 0 },
      { from: 'tasks', limit: 501 },
      { from: 'tasks', offset: -1 },
      { from: 'tasks', select: Array(21).fill('key') },
      { from: 'tasks', drop: true },
    ];
    for (const body of bad) {
      const res = await dev.post('/api/_query', body);
      assert.equal(res.status, 422, JSON.stringify(body));
    }
  });

  it('lists queryable collections with per-caller counts', async () => {
    const res =
      await dev.get<Record<string, { fields: string[]; count: number }>>('/api/_query/collections');
    assert.ok(res.json.tasks.count > 0);
    assert.ok(!res.json.members.fields.includes('passwordHash'));
  });
});
