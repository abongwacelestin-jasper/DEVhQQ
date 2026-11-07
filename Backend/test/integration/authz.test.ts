/**
 * Authorization matrix, generated from tables:
 *
 *  1. every non-public route in the live inventory refuses anonymous callers
 *     and password-only (pre-MFA) sessions,
 *  2. each role × each sensitive route gets the expected status — guards run
 *     before validation and lookups, so "allowed" roles see 404/422 on a probe
 *     that touches nothing, and "denied" roles see 403,
 *  3. out-of-scope resources answer 404, never 403 (existence is not leaked).
 */

import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import {
  DEMO_ACCOUNTS,
  DEMO_KEYS,
  passwordOnly,
  signInAll,
  type DemoKey,
} from '../helpers/auth.ts';
import type { RouteInfo } from '../../lib/http.ts';

let app: TestServer;
let as: Record<DemoKey, Client>;
let inventory: RouteInfo[];

before(async () => {
  app = await startApp();
  as = await signInAll(app);
  const inv = await as.admin.get<RouteInfo[]>('/api/_inventory');
  assert.equal(inv.status, 200);
  inventory = inv.json;
});
after(() => app.close());

const concrete = (path: string) => path.replace(/:([a-zA-Z]+)/g, 'probe-$1');

describe('authz — authentication is required on every guarded route', () => {
  it('the inventory is non-trivial and classifies routes', () => {
    assert.ok(inventory.length > 50, String(inventory.length));
    assert.ok(inventory.some((r) => r.auth === 'public'));
    assert.ok(inventory.some((r) => r.auth === 'session'));
  });

  it('anonymous → 401 on every non-public route', async () => {
    const failures: string[] = [];
    for (const r of inventory.filter((x) => x.auth !== 'public')) {
      const res = await app.client().request(r.method, concrete(r.path), {
        body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
      });
      if (res.status !== 401) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    assert.deepEqual(failures, []);
  });

  it('password-only session → 401 mfa_required on every full-session route', async () => {
    const half = await passwordOnly(app, DEMO_ACCOUNTS.developer.email);
    const failures: string[] = [];
    for (const r of inventory.filter((x) => x.auth === 'session')) {
      const res = await half.request(r.method, concrete(r.path), {
        body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
      });
      if (res.status !== 401 || errorCode(res) !== 'mfa_required')
        failures.push(`${r.method} ${r.path} → ${res.status} ${errorCode(res)}`);
    }
    assert.deepEqual(failures, []);
  });

  it('public routes really are reachable without a session', async () => {
    for (const path of [
      '/api/health',
      '/api/ready',
      '/api/version',
      '/api/openapi.json',
      '/api/_status-codes',
    ]) {
      assert.equal((await app.client().get(path)).status, 200, path);
    }
  });
});

/**
 * Role × route expectations. `allow` lists the roles that pass the guards;
 * `ok` is what an allowed role gets for the harmless probe (usually a 404 for
 * a non-existent id or a 422 for an empty body). Everyone else must get 403.
 */
interface Rule {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  allow: DemoKey[];
  ok: number;
  /** Area/level being enforced — documentation for the failure message. */
  needs: string;
}

const OWNER_OPS: DemoKey[] = ['admin', 'operations'];
const CONTRIBUTORS: DemoKey[] = ['admin', 'pm', 'developer', 'designer', 'tester'];
const INFRA_VIEW: DemoKey[] = ['admin', 'developer', 'operations'];
const ALL_BUT_DESIGNER: DemoKey[] = ['admin', 'pm', 'developer', 'tester', 'operations'];

const RULES: Rule[] = [
  // Projects / tasks / docs
  { method: 'GET', path: '/api/tasks', allow: DEMO_KEYS, ok: 200, needs: 'Project:view' },
  {
    method: 'POST',
    path: '/api/tasks',
    body: {},
    allow: CONTRIBUTORS,
    ok: 422,
    needs: 'Project:contribute',
  },
  {
    method: 'PATCH',
    path: '/api/tasks/NOPE-1',
    body: {},
    allow: CONTRIBUTORS,
    ok: 404,
    needs: 'Project:contribute',
  },
  {
    method: 'DELETE',
    path: '/api/tasks/NOPE-1',
    allow: ['admin', 'pm'],
    ok: 404,
    needs: 'Project:manage',
  },
  {
    method: 'POST',
    path: '/api/tasks/NOPE-1/comments',
    body: { text: 'x' },
    allow: CONTRIBUTORS,
    ok: 404,
    needs: 'Project:contribute',
  },
  {
    method: 'POST',
    path: '/api/tasks/NOPE-1/subtasks',
    body: { title: 'x' },
    allow: CONTRIBUTORS,
    ok: 404,
    needs: 'Project:contribute',
  },
  {
    method: 'POST',
    path: '/api/tasks/NOPE-1/time',
    body: { minutes: 5 },
    allow: CONTRIBUTORS,
    ok: 404,
    needs: 'Project:contribute',
  },
  {
    method: 'POST',
    path: '/api/docs',
    body: {},
    allow: CONTRIBUTORS,
    ok: 422,
    needs: 'Project:contribute',
  },
  {
    method: 'PATCH',
    path: '/api/docs/nope',
    body: {},
    allow: CONTRIBUTORS,
    ok: 404,
    needs: 'Project:contribute',
  },
  {
    method: 'DELETE',
    path: '/api/docs/nope',
    allow: ['admin', 'pm'],
    ok: 404,
    needs: 'Project:manage',
  },
  { method: 'GET', path: '/api/projects', allow: DEMO_KEYS, ok: 200, needs: 'Project:view' },
  // Delivery
  {
    method: 'GET',
    path: '/api/deployments',
    allow: ALL_BUT_DESIGNER,
    ok: 200,
    needs: 'Deployment:view',
  },
  {
    method: 'POST',
    path: '/api/deployments',
    body: {},
    allow: OWNER_OPS,
    ok: 422,
    needs: 'Deployment:contribute',
  },
  {
    method: 'POST',
    path: '/api/deployments/nope/approve',
    allow: OWNER_OPS,
    ok: 404,
    needs: 'Deployment:manage + step-up',
  },
  {
    method: 'POST',
    path: '/api/deployments/nope/rollback',
    allow: OWNER_OPS,
    ok: 404,
    needs: 'Deployment:manage',
  },
  // Team & access
  { method: 'GET', path: '/api/team', allow: DEMO_KEYS, ok: 200, needs: 'Organization:view' },
  {
    method: 'POST',
    path: '/api/team/invites',
    body: {},
    allow: ['admin'],
    ok: 422,
    needs: 'Organization:admin + step-up',
  },
  {
    method: 'PATCH',
    path: '/api/team/m999',
    body: {},
    allow: ['admin'],
    ok: 404,
    needs: 'Organization:admin + step-up',
  },
  {
    method: 'GET',
    path: '/api/access/grants',
    allow: OWNER_OPS,
    ok: 200,
    needs: 'Administration:view',
  },
  {
    method: 'POST',
    path: '/api/access/grants/nope/revoke',
    allow: OWNER_OPS,
    ok: 404,
    needs: 'Deployment:manage + step-up',
  },
  // Infrastructure
  {
    method: 'POST',
    path: '/api/backups/drill',
    allow: OWNER_OPS,
    ok: 200,
    needs: 'Infrastructure:manage + step-up',
  },
  // ── Wave 4 routes ──
  {
    method: 'GET',
    path: '/api/monitors',
    allow: INFRA_VIEW,
    ok: 200,
    needs: 'Infrastructure:view',
  },
  {
    method: 'POST',
    path: '/api/monitors',
    body: {},
    allow: OWNER_OPS,
    ok: 422,
    needs: 'Infrastructure:manage',
  },
  {
    method: 'PATCH',
    path: '/api/monitors/nope',
    body: {},
    allow: OWNER_OPS,
    ok: 404,
    needs: 'Infrastructure:manage',
  },
  {
    method: 'DELETE',
    path: '/api/monitors/nope',
    allow: OWNER_OPS,
    ok: 404,
    needs: 'Infrastructure:manage',
  },
  {
    method: 'GET',
    path: '/api/backups/snapshots',
    allow: OWNER_OPS,
    ok: 200,
    needs: 'Infrastructure:manage',
  },
  {
    method: 'POST',
    path: '/api/backups/nope/restore',
    body: {},
    allow: ['admin'],
    ok: 404,
    needs: 'Administration:admin + step-up',
  },
  {
    method: 'GET',
    path: '/api/integrations',
    allow: OWNER_OPS,
    ok: 200,
    needs: 'Administration:view',
  },
  {
    method: 'DELETE',
    path: '/api/integrations/nope',
    allow: ['admin'],
    ok: 404,
    needs: 'Administration:manage + step-up',
  },
  {
    method: 'GET',
    path: '/api/integrations/nope/webhooks',
    allow: OWNER_OPS,
    ok: 404,
    needs: 'Administration:view',
  },
  {
    method: 'POST',
    path: '/api/integrations/nope/webhooks',
    body: {},
    allow: ['admin'],
    ok: 422,
    needs: 'Administration:manage + step-up',
  },
  {
    method: 'GET',
    path: '/api/offboarding',
    allow: OWNER_OPS,
    ok: 200,
    needs: 'Administration:view',
  },
  { method: 'GET', path: '/api/repos', allow: DEMO_KEYS, ok: 200, needs: 'Repository:view' },
  {
    method: 'POST',
    path: '/api/repos',
    body: {},
    allow: ['admin'],
    ok: 422,
    needs: 'Repository:manage',
  },
  {
    method: 'POST',
    path: '/api/security/code-findings',
    body: {},
    allow: ['admin'],
    ok: 422,
    needs: 'Repository:manage',
  },
];

describe('authz — role × sensitive route matrix', () => {
  for (const rule of RULES) {
    for (const role of DEMO_KEYS) {
      const allowed = rule.allow.includes(role);
      const expected = allowed ? rule.ok : 403;
      it(`${role.padEnd(10)} ${rule.method} ${rule.path} → ${expected} (${rule.needs})`, async () => {
        const res = await as[role].request(rule.method, rule.path, { body: rule.body });
        assert.equal(res.status, expected, res.text);
        if (!allowed) assert.equal(errorCode(res), 'forbidden');
      });
    }
  }
});

describe('authz — product scope answers 404, never 403', () => {
  // [role, method, path, body?] — each targets a seeded resource outside the role's products.
  const hidden: [DemoKey, 'GET' | 'PATCH' | 'POST' | 'DELETE', string, unknown?][] = [
    ['developer', 'GET', '/api/tasks/BL-17'],
    ['developer', 'GET', '/api/tasks/bl-17'],
    ['developer', 'PATCH', '/api/tasks/BL-17', { priority: 'low' }],
    ['developer', 'POST', '/api/tasks/MA-38/comments', { text: 'hi' }],
    ['pm', 'DELETE', '/api/tasks/MA-38'],
    ['developer', 'GET', '/api/projects/p4'],
    ['designer', 'GET', '/api/projects/p4'],
    ['pm', 'GET', '/api/incidents/INC-32'],
    ['pm', 'PATCH', '/api/incidents/INC-32', { note: 'peek' }],
    // Restricted doc: only editors (m4, m11) and Owners.
    ['pm', 'GET', '/api/docs/doc-api-runbook'],
    ['designer', 'GET', '/api/docs/doc-api-runbook'],
    ['tester', 'PATCH', '/api/docs/doc-api-runbook', { title: 'mine now' }],
  ];
  for (const [role, method, path, body] of hidden) {
    it(`${role} ${method} ${path} → 404`, async () => {
      const res = await as[role].request(method, path, { body });
      assert.equal(res.status, 404, res.text);
      assert.equal(errorCode(res), 'not_found');
    });
  }

  it('in-scope counterparts are visible (the 404s above are scope, not absence)', async () => {
    assert.equal((await as.admin.get('/api/tasks/BL-17')).status, 200);
    assert.equal((await as.developer.get('/api/docs/doc-api-runbook')).status, 200, 'editor');
    assert.equal((await as.admin.get('/api/docs/doc-api-runbook')).status, 200, 'owner');
    assert.equal((await as.tester.get('/api/incidents/INC-32')).status, 200);
  });

  it('lists are filtered server-side to the caller’s products', async () => {
    for (const key of DEMO_KEYS) {
      const allowed = new Set<string>(DEMO_ACCOUNTS[key].products);
      const tasks = await as[key].get<{ items: { product: string }[] }>('/api/tasks?limit=200');
      assert.ok(
        tasks.json.items.every((t) => allowed.has(t.product)),
        `${key} tasks`,
      );
      const projects = await as[key].get<{ product: string }[]>('/api/projects');
      assert.ok(
        projects.json.every((p) => allowed.has(p.product)),
        `${key} projects`,
      );
      const incidents = await as[key].get<{ product: string }[]>('/api/incidents');
      assert.ok(
        incidents.json.every((i) => allowed.has(i.product)),
        `${key} incidents`,
      );
      const docs = await as[key].get<{ product: string; body?: string }[]>('/api/docs');
      assert.ok(
        docs.json.every((d) => allowed.has(d.product) && d.body === undefined),
        `${key} docs`,
      );
      const products = await as[key].get<{ id: string }[]>('/api/products');
      assert.deepEqual(new Set(products.json.map((p) => p.id)), allowed, `${key} products`);
    }
  });

  it('the query runner is scoped the same way', async () => {
    const res = await as.developer.post<{ rows: { product: string }[] }>('/api/_query', {
      from: 'tasks',
      select: ['key', 'product'],
      limit: 500,
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.rows.length > 0);
    assert.ok(res.json.rows.every((r) => r.product === 'renewberry'));
  });
});

describe('authz — capabilities endpoint mirrors the matrix for the caller only', () => {
  it('returns the caller’s row of the matrix', async () => {
    for (const key of DEMO_KEYS) {
      const caps = await as[key].get<{ role: string; matrix: Record<string, string> }>(
        '/api/me/capabilities',
      );
      const roles = await as[key].get<Record<string, Record<string, string>>>('/api/team/roles');
      assert.equal(caps.json.role, DEMO_ACCOUNTS[key].role);
      for (const [area, row] of Object.entries(roles.json))
        assert.equal(caps.json.matrix[area], row[DEMO_ACCOUNTS[key].role], `${key} ${area}`);
    }
  });
});
