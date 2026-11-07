/**
 * End-to-end smoke test. Boots the app in-process on a random port and walks
 * the critical paths: health, demo sign-in for every role, password + MFA,
 * scoped reads, a write, the query runner and the security checks that must
 * fail closed. Exits non-zero on the first failure.
 *
 *   npm run smoke   (also: npm test)
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// Isolate each run's audit file so repeated gate runs never share state.
process.env.AUDIT_LOG_FILE = `/tmp/devhq-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`;

const { buildApp } = await import('../server.ts');
const router = await buildApp();
const server = createServer((req, res) => void router.handle(req, res));
await new Promise<void>((r) => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let passed = 0;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-DevHQ-Client': 'console',
      'User-Agent': 'devhq-smoke',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function expect(name: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    console.error(`✗ ${name}`, detail ?? '');
    server.close();
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${name}`);
}

async function raw(path: string) {
  const res = await fetch(base + path, { headers: { 'User-Agent': 'devhq-smoke' } });
  return {
    status: res.status,
    text: await res.text(),
    type: res.headers.get('content-type') ?? '',
    csp: res.headers.get('content-security-policy') ?? '',
  };
}

const health = await call('GET', '/api/health');
expect('health is 200', health.status === 200);

const consolePage = await raw('/console');
expect(
  'backend console renders the operations UI',
  consolePage.status === 200 &&
    consolePage.type.startsWith('text/html') &&
    consolePage.text.includes('<title>DevHQ · Backend control room</title>') &&
    consolePage.text.includes('API explorer') &&
    consolePage.text.includes('Security & audit') &&
    consolePage.text.includes('Team & access') &&
    consolePage.text.includes('@media (max-width: 860px)') &&
    consolePage.text.includes('@media (max-width: 430px)'),
  `${consolePage.status} ${consolePage.type}`,
);
expect(
  'console navigation exposes functional sidebar, mobile drawer and command search',
  consolePage.text.includes('id="sidebar-collapse"') &&
    consolePage.text.includes('id="mobile-more"') &&
    consolePage.text.includes('id="global-search"') &&
    consolePage.text.includes('id="refresh-current"') &&
    consolePage.text.includes('id="profile-menu"'),
);
expect(
  'console exposes guided deployment, incident, backup and access controls',
  consolePage.text.includes('id="deployment-form"') &&
    consolePage.text.includes('id="incident-update-form"') &&
    consolePage.text.includes('data-action="create-backup"') &&
    consolePage.text.includes('id="member-update-form"') &&
    consolePage.text.includes('id="grant-form"') &&
    consolePage.text.includes('id="sessions-table"') &&
    consolePage.text.includes('id="signins-table"'),
);
expect(
  'console exposes structured metrics and query export',
  consolePage.text.includes('id="metrics-table"') &&
    consolePage.text.includes('id="query-result-table"') &&
    consolePage.text.includes('id="export-query"') &&
    consolePage.text.includes('.overview-stats'),
);
expect(
  'console scripts are protected by a per-response nonce',
  /script-src 'nonce-[^']+'/.test(consolePage.csp) &&
    /<script nonce="[^"]+">/.test(consolePage.text),
);
const backendAlias = await raw('/backend.html');
expect(
  'backend.html alias serves the same console',
  backendAlias.status === 200 &&
    backendAlias.text.includes('<title>DevHQ · Backend control room</title>'),
);

const spec = await call('GET', '/api/openapi.json');
expect(
  'OpenAPI document lists the task routes',
  spec.status === 200 && !!(spec.json.paths as Record<string, unknown> | undefined)?.['/api/tasks'],
  spec.status,
);

for (const role of ['admin', 'pm', 'developer', 'designer', 'tester', 'operations']) {
  const r = await call('POST', '/api/auth/demo', { role });
  expect(`demo sign-in: ${role}`, r.status === 200 && typeof r.json.token === 'string', r.json);
}

const pw = await call('POST', '/api/auth/sign-in', {
  email: 'kofi@techorg.io',
  password: 'devhq-demo',
});
expect('password step accepted', pw.status === 200 && typeof pw.json.token === 'string', pw.json);
const early = await call('GET', '/api/tasks', undefined, pw.json.token as string);
expect('API refused before MFA', early.status === 401);
const mfa = await call('POST', '/api/auth/mfa/totp', { code: '246810' }, pw.json.token as string);
expect('MFA accepted', mfa.status === 200, mfa.json);
const dev = mfa.json.token as string;

const tasks = await call('GET', '/api/tasks', undefined, dev);
const items = (tasks.json.items as { product: string }[]) ?? [];
expect(
  'developer sees only renewberry tasks',
  tasks.status === 200 && items.length > 0 && items.every((t) => t.product === 'renewberry'),
  tasks.json,
);
const hidden = await call('GET', '/api/tasks/BL-17', undefined, dev);
expect('out-of-scope task is 404', hidden.status === 404);

const created = await call(
  'POST',
  '/api/tasks',
  {
    projectId: 'p1',
    title: 'Smoke test task',
    type: 'task',
    priority: 'low',
    assignee: 'm4',
    due: '2026-11-30',
    estimate: 1,
  },
  dev,
);
expect('task created', created.status === 201, created.json);

const smuggle = await call('PATCH', `/api/tasks/${created.json.key}`, { role: 'Owner' }, dev);
expect('unknown fields rejected', smuggle.status === 422);

const newKey = created.json.key as string;
const activity = await call('GET', '/api/tasks/_activity', undefined, dev);
expect(
  'task activity arrives in one call',
  activity.status === 200 &&
    Array.isArray(activity.json.events) &&
    Array.isArray(activity.json.subtasks),
  activity.json,
);

const comment = await call('POST', `/api/tasks/${newKey}/comments`, { text: 'Smoke comment' }, dev);
expect('comment recorded', comment.status === 201 && comment.json.taskKey === newKey, comment.json);
const subtask = await call(
  'POST',
  `/api/tasks/${newKey}/subtasks`,
  { title: 'Smoke subtask' },
  dev,
);
expect('subtask added', subtask.status === 201, subtask.json);
const completed = await call(
  'PATCH',
  `/api/tasks/${newKey}/subtasks/${subtask.json.id}`,
  { done: true },
  dev,
);
expect(
  'subtask completed',
  completed.status === 200 && completed.json.done === true,
  completed.json,
);
const time = await call('POST', `/api/tasks/${newKey}/time`, { minutes: 15, note: 'smoke' }, dev);
expect('time logged', time.status === 201 && time.json.minutes === 15, time.json);
const reread = await call('GET', `/api/tasks/${newKey}`, undefined, dev);
expect('comment count is derived on read', reread.json.comments === 1, reread.json);

const products = await call('GET', '/api/products', undefined, dev);
expect(
  'products list is scoped to the caller',
  products.status === 200 &&
    Array.isArray(products.json) &&
    (products.json as { id: string }[]).every((p) => p.id === 'renewberry'),
  products.json,
);

const q = await call(
  'POST',
  '/api/_query',
  { from: 'tasks', where: { priority: { in: ['urgent', 'high'] } }, select: ['key', 'priority'] },
  dev,
);
expect('query runner works', q.status === 200 && typeof q.json.total === 'number', q.json);
const qBad = await call('POST', '/api/_query', { from: 'members', select: ['passwordHash'] }, dev);
expect('secret fields not queryable', qBad.status === 422);

const bad = await call('POST', '/api/auth/sign-in', {
  email: 'kofi@techorg.io',
  password: 'wrong',
});
const unknown = await call('POST', '/api/auth/sign-in', {
  email: 'nobody@techorg.io',
  password: 'wrong',
});
expect(
  'same error for wrong password and unknown user',
  bad.status === 401 &&
    unknown.status === 401 &&
    (bad.json.error as { code: string }).code === (unknown.json.error as { code: string }).code,
);

// ── ML lane (wave4/ML): insights + assistant bridge ─────────────────────────
{
  const { sign, verifySignature, signedHeaders } = await import('../integrations/ml/signing.ts');
  const { resetCircuit } = await import('../integrations/ml/client.ts');
  delete process.env.ML_SERVICE_URL;
  delete process.env.ML_SERVICE_TOKEN;

  expect(
    'ML: HMAC signing matches the Python service test vector',
    sign(
      'devhq-test-vector-token',
      '1700000000',
      '00112233445566778899aabbccddeeff',
      'POST',
      '/v1/predict/overdue',
      '{"estimate":8}',
    ) === 'v1=d7856a999027e2ace3c8110c1cb32f8322cfb48b19efc4e5b3499a9f2ae32e83',
  );

  const ti = await call('GET', `/api/insights/tasks/${newKey}`, undefined, dev);
  expect(
    'ML: task insight falls back to heuristic when ML_SERVICE_URL is unset',
    ti.status === 200 &&
      ti.json.source === 'heuristic' &&
      ti.json.fallbackReason === 'unconfigured' &&
      typeof (ti.json.eta as { p50?: unknown }).p50 === 'number',
    ti.json,
  );
  const tiHidden = await call('GET', '/api/insights/tasks/BL-17', undefined, dev);
  expect('ML: out-of-scope task insight is 404', tiHidden.status === 404, tiHidden.json);

  const deploys = await call('GET', '/api/deployments', undefined, dev);
  const depId = (deploys.json as unknown as { id: string }[])[0]?.id;
  const di = await call('GET', `/api/insights/deployments/${depId}`, undefined, dev);
  expect(
    'ML: deployment risk falls back to heuristic',
    di.status === 200 && di.json.source === 'heuristic' && typeof di.json.score === 'number',
    di.json,
  );
  const si = await call('GET', '/api/insights/signins/seed0', undefined, dev);
  expect('ML: another member’s sign-in insight is 404 for a developer', si.status === 404);

  const ask = await call('POST', '/api/assistant/ask', { question: 'What is blocked?' }, dev);
  expect(
    'ML: assistant returns 503 integration_unconfigured without the ML service',
    ask.status === 503 && (ask.json.error as { code: string }).code === 'integration_unconfigured',
    ask.json,
  );
  const exportAnon = await call('GET', '/api/insights/_export');
  const exportDev = await call('GET', '/api/insights/_export', undefined, dev);
  expect(
    'ML: training export needs Administration:admin or a service signature',
    exportAnon.status === 401 && exportDev.status === 403,
    [exportAnon.status, exportDev.status],
  );

  // A stub ML service that verifies our signatures exactly like the Python one.
  const token = 'smoke-ml-token-0123456789abcdef0123456789';
  let mode: 'ok' | 'fail' = 'ok';
  let lastContextIds: string[] = [];
  let unsigned = 0;
  const stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const h = (n: string) => String(req.headers[n] ?? '');
      const bad = verifySignature(
        token,
        {
          signature: h('x-devhq-signature'),
          timestamp: h('x-devhq-timestamp'),
          nonce: h('x-devhq-nonce'),
        },
        req.method ?? '',
        req.url ?? '',
        body,
      );
      const reply = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (bad) {
        unsigned++;
        return reply(401, { error: { code: bad, message: 'unsigned' } });
      }
      if (mode === 'fail') return reply(500, { error: { code: 'boom', message: 'down' } });
      const model = { name: 'stub', version: 'v0', trainedOn: 'synthetic' };
      if (req.url === '/v1/predict/task-eta')
        return reply(200, { etaDays: { p10: 1, p50: 2, p90: 4 }, model });
      if (req.url === '/v1/predict/overdue')
        return reply(200, { probability: 0.42, drivers: ['Due in 2 days'], model });
      if (req.url === '/v1/assistant/answer') {
        const parsed = JSON.parse(body) as { context: { id: string }[] };
        lastContextIds = parsed.context.map((c) => c.id);
        return reply(200, {
          answer: 'Stub answer',
          sources: [
            { id: lastContextIds[0], kind: 'task', title: 't' },
            { id: 'task:BL-17', kind: 'task', title: 'not sent — must be dropped' },
          ],
          model: 'claude-sonnet-5-5',
          stopReason: 'end_turn',
          grounded: true,
        });
      }
      return reply(404, { error: { code: 'not_found', message: 'nope' } });
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  process.env.ML_SERVICE_TOKEN = token;
  resetCircuit();

  const tm = await call('GET', `/api/insights/tasks/${newKey}`, undefined, dev);
  expect(
    'ML: signed call to the ML service returns source:model',
    tm.status === 200 &&
      tm.json.source === 'model' &&
      (tm.json.overdue as { probability: number }).probability === 0.42 &&
      unsigned === 0,
    tm.json,
  );
  const am = await call('POST', '/api/assistant/ask', { question: 'What is blocked?' }, dev);
  const amSources = (am.json.sources as { id: string }[] | undefined) ?? [];
  expect(
    'ML: assistant context is scoped to the caller and unsent sources are dropped',
    am.status === 200 &&
      lastContextIds.length > 0 &&
      lastContextIds.every((id) => !id.startsWith('task:BL-') && !id.startsWith('task:MA-')) &&
      amSources.length === 1 &&
      amSources[0].id === lastContextIds[0],
    { status: am.status, sources: amSources, sent: lastContextIds.slice(0, 5) },
  );

  const exportPath = '/api/insights/_export';
  const signedExport = await fetch(base + exportPath, {
    headers: { 'User-Agent': 'devhq-smoke', ...signedHeaders(token, 'GET', exportPath) },
  });
  const exportJson = (await signedExport.json()) as { source?: string; tasks?: unknown[] };
  expect(
    'ML: service-signed training export is accepted',
    signedExport.status === 200 &&
      exportJson.source === 'backend' &&
      Array.isArray(exportJson.tasks),
    signedExport.status,
  );

  mode = 'fail';
  for (let i = 0; i < 5; i++) await call('GET', `/api/insights/tasks/${newKey}`, undefined, dev);
  const tripped = await call('GET', `/api/insights/tasks/${newKey}`, undefined, dev);
  expect(
    'ML: circuit opens after repeated failures and insights stay on heuristics',
    tripped.status === 200 &&
      tripped.json.source === 'heuristic' &&
      tripped.json.fallbackReason === 'circuit_open',
    tripped.json,
  );

  stub.close();
  resetCircuit();
  delete process.env.ML_SERVICE_URL;
  delete process.env.ML_SERVICE_TOKEN;
}

const audit = await call('GET', '/api/audit/verify', undefined, dev);
expect('audit chain intact', audit.json.ok === true, audit.json);

console.log(`\n${passed} checks passed`);
server.close();
process.exit(0);
