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

// ── Wave 4 · B-DOMAIN: engineering domains (GitHub, repos/PRs/CI, monitors, integrations) ──
{
  const { createHmac } = await import('node:crypto');
  const ssrf = await import('../monitors/ssrf.ts');
  const engStore = await import('../domain/engineering/store.ts');
  const outbound = await import('../integrations/webhooks/dispatcher.ts');
  // Checks below are triggered explicitly; the background loop must not add extra ones.
  (await import('../monitors/scheduler.ts')).stopMonitorScheduler();

  const admin = (await call('POST', '/api/auth/demo', { role: 'admin' })).json.token as string;
  const ops = (await call('POST', '/api/auth/demo', { role: 'operations' })).json.token as string;

  // Demo source is labelled, and scoped to the caller's products.
  const demoRepos = await call('GET', '/api/repos', undefined, dev);
  const demoItems = (demoRepos.json.items as { product: string; source: string }[]) ?? [];
  expect(
    'B-DOMAIN: demo repos are labelled source:demo and product-scoped',
    demoRepos.status === 200 &&
      demoRepos.json.source === 'demo' &&
      demoItems.length > 0 &&
      demoItems.every((x) => x.source === 'demo' && x.product === 'renewberry'),
    demoRepos.json,
  );
  const demoPulls = await call('GET', '/api/pulls?repo=renewberry/api', undefined, dev);
  expect(
    'B-DOMAIN: demo PRs carry the frontend PullRequest shape',
    demoPulls.status === 200 &&
      demoPulls.json.source === 'demo' &&
      (demoPulls.json.items as Record<string, unknown>[]).some(
        (p) =>
          p.number === 148 &&
          p.taskKey === 'RB-212' &&
          p.review === 'review-required' &&
          typeof p.age === 'string',
      ),
    demoPulls.json,
  );
  const hiddenRepo = await call('GET', '/api/repos/demo-blog-platform', undefined, dev);
  const hiddenPulls = await call('GET', '/api/pulls?repo=blog/platform', undefined, dev);
  const hiddenFindings = await call(
    'GET',
    '/api/security/code-findings?repo=blog/platform',
    undefined,
    dev,
  );
  expect(
    'B-DOMAIN: out-of-scope repo is 404 (detail, PR filter, findings filter)',
    hiddenRepo.status === 404 && hiddenPulls.status === 404 && hiddenFindings.status === 404,
    [hiddenRepo.status, hiddenPulls.status, hiddenFindings.status],
  );

  // GitHub webhook: unconfigured → 503; then signed, invalid, replayed.
  async function hook(
    event: string,
    delivery: string,
    payload: unknown,
    secret?: string,
    sig?: string,
  ) {
    const body = JSON.stringify(payload);
    const res = await fetch(base + '/api/github/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GitHub-Hookshot/smoke',
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': delivery,
        'X-Hub-Signature-256':
          sig ??
          `sha256=${createHmac('sha256', secret ?? '')
            .update(body)
            .digest('hex')}`,
      },
      body,
    });
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }
  const unconfigured = await hook('ping', 'smoke-0', { zen: 'hi' }, 'x');
  expect(
    'B-DOMAIN: webhook without GITHUB_WEBHOOK_SECRET is 503',
    unconfigured.status === 503,
    unconfigured.json,
  );

  const secret = 'smoke-webhook-secret';
  process.env.GITHUB_WEBHOOK_SECRET = secret;
  engStore.ghIdentities.set('kofi-gh', { login: 'kofi-gh', memberId: 'm4' });
  const repoPayload = {
    id: 9001,
    full_name: 'renewberry/api',
    default_branch: 'main',
    language: 'TypeScript',
    private: true,
  };
  const prPayload = {
    action: 'opened',
    sender: { login: 'kofi-gh' },
    repository: repoPayload,
    pull_request: {
      number: 301,
      title: 'Export invoices as CSV',
      state: 'open',
      user: { login: 'kofi-gh' },
      head: { ref: 'feat/rb-230-invoice-export', sha: 'f'.repeat(40) },
      base: { ref: 'main' },
      requested_reviewers: [{ login: 'lena-gh' }],
      additions: 120,
      deletions: 4,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
  const badSig = await hook('pull_request', 'smoke-1', prPayload, 'wrong-secret');
  const malformed = await hook('pull_request', 'smoke-1', prPayload, undefined, 'sha256=nothex');
  expect(
    'B-DOMAIN: invalid webhook signature is 401',
    badSig.status === 401 &&
      malformed.status === 401 &&
      (badSig.json.error as { code: string }).code === 'invalid_signature',
    badSig.json,
  );
  const prHook = await hook('pull_request', 'smoke-1', prPayload, secret);
  expect(
    'B-DOMAIN: valid signed pull_request webhook accepted and links RB-230',
    prHook.status === 202 && prHook.json.handled === true && prHook.json.linkedTask === 'RB-230',
    prHook.json,
  );
  const replay = await hook('pull_request', 'smoke-1', prPayload, secret);
  expect('B-DOMAIN: replayed delivery id is 409', replay.status === 409, replay.json);

  const linkedTask = await call('GET', '/api/tasks/RB-230', undefined, dev);
  const act = await call('GET', '/api/tasks/_activity', undefined, dev);
  expect(
    'B-DOMAIN: task.pr set and a linked task event recorded',
    linkedTask.json.pr === 301 &&
      (act.json.events as { taskKey: string; kind: string; to?: string }[]).some(
        (e) => e.taskKey === 'RB-230' && e.kind === 'linked' && e.to === 'PR #301',
      ),
    linkedTask.json,
  );

  const runHook = await hook(
    'workflow_run',
    'smoke-2',
    {
      action: 'completed',
      repository: repoPayload,
      workflow_run: {
        id: 77,
        name: 'CI',
        head_branch: 'feat/rb-230-invoice-export',
        head_sha: 'f'.repeat(40),
        status: 'completed',
        conclusion: 'failure',
        event: 'pull_request',
        pull_requests: [{ number: 301 }],
        run_started_at: new Date(Date.now() - 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    },
    secret,
  );
  const livePulls = await call('GET', '/api/pulls?repo=renewberry/api', undefined, dev);
  const livePr = (livePulls.json.items as Record<string, unknown>[]).find((p) => p.number === 301);
  const runs = await call('GET', '/api/ci/runs?repo=renewberry/api', undefined, dev);
  expect(
    'B-DOMAIN: live mode serves webhook data (source:github), CI run updates PR status',
    runHook.status === 202 &&
      livePulls.json.source === 'github' &&
      livePr?.ci === 'failing' &&
      livePr?.source === 'github' &&
      (runs.json.items as { id: string }[]).some((x) => x.id === 'gh-wr-77'),
    livePulls.json,
  );

  const selfReview = await call(
    'POST',
    `/api/pulls/renewberry%2Fapi/301/review`,
    { decision: 'approve' },
    dev,
  );
  const ownerReview = await call(
    'POST',
    `/api/pulls/gh-9001/301/review`,
    { decision: 'approve', body: 'LGTM' },
    admin,
  );
  expect(
    'B-DOMAIN: authors cannot approve their own PR; another reviewer can',
    selfReview.status === 403 &&
      (selfReview.json.error as { code: string }).code === 'self_approval' &&
      ownerReview.status === 200 &&
      ownerReview.json.review === 'approved',
    [selfReview.json, ownerReview.json],
  );

  // Code findings: CI ingest (Repository:manage), secrets masked, dedup on re-ingest.
  const leaked = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0';
  const ingest = {
    repo: 'renewberry/api',
    tool: 'gitleaks',
    findings: [
      {
        kind: 'secret',
        severity: 'high',
        title: 'GitHub token committed',
        location: 'src/ci.ts:3',
        detail: `found ${leaked}`,
      },
    ],
  };
  const devIngest = await call('POST', '/api/security/code-findings', ingest, dev);
  const ing1 = await call('POST', '/api/security/code-findings', ingest, admin);
  const ing2 = await call('POST', '/api/security/code-findings', ingest, admin);
  const listed = await call(
    'GET',
    '/api/security/code-findings?repo=renewberry/api',
    undefined,
    dev,
  );
  expect(
    'B-DOMAIN: findings ingest needs Repository:manage, masks secrets and de-duplicates',
    devIngest.status === 403 &&
      ing1.json.created === 1 &&
      ing2.json.updated === 1 &&
      !JSON.stringify(listed.json).includes(leaked) &&
      (listed.json.items as { title: string }[]).filter((f) => f.title === 'GitHub token committed')
        .length === 1,
    listed.json,
  );

  // SSRF guard.
  const blocked = async (u: string) => {
    try {
      await ssrf.vetUrl(u);
      return false;
    } catch (e) {
      return e instanceof ssrf.BlockedTargetError;
    }
  };
  const restoreDns = ssrf.setOutboundDeps({
    resolver: async (h) =>
      h === 'internal.example.com'
        ? [{ address: '10.1.2.3', family: 4 }]
        : h === 'rebind.example.com'
          ? [
              { address: '93.184.216.34', family: 4 },
              { address: 'fd00:ec2::254', family: 6 },
            ]
          : [{ address: '93.184.216.34', family: 4 }],
  });
  const ssrfResults = {
    loopback: await blocked('http://127.0.0.1'),
    metadata: await blocked('http://169.254.169.254/latest/meta-data/'),
    mapped: await blocked('http://[::ffff:10.0.0.1]/'),
    decimal: await blocked('http://2130706433/'),
    cgnat: await blocked('http://100.64.0.1/'),
    privateDns: await blocked('http://internal.example.com/health'),
    mixedDns: await blocked('https://rebind.example.com/'),
    scheme: await blocked('file:///etc/passwd'),
    publicOk: !(await blocked('https://status.example.com/health')),
  };
  expect(
    'B-DOMAIN: SSRF guard blocks loopback, metadata, IPv4-mapped IPv6, private DNS; allows public',
    Object.values(ssrfResults).every(Boolean),
    ssrfResults,
  );
  const ssrfApi = await call(
    'POST',
    '/api/monitors',
    { product: 'renewberry', name: 'Metadata', url: 'http://169.254.169.254/latest' },
    ops,
  );
  expect(
    'B-DOMAIN: monitor create rejects a blocked target (422 blocked_target)',
    ssrfApi.status === 422 && (ssrfApi.json.error as { code: string }).code === 'blocked_target',
    ssrfApi.json,
  );

  // Monitor failure → incident (owner = Operations member), recovery → auto-resolve.
  let upstream = 503;
  const sent: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const restoreTransport = ssrf.setOutboundDeps({
    transport: async (r) => {
      if (r.method === 'POST') {
        sent.push({ url: r.url.toString(), headers: r.headers, body: r.body });
        return { status: 200, headers: {}, body: 'ok', truncated: false };
      }
      return { status: upstream, headers: {}, body: '', truncated: false };
    },
  });
  const devCreate = await call(
    'POST',
    '/api/monitors',
    { product: 'renewberry', name: 'Nope', url: 'https://status.example.com/' },
    dev,
  );
  const shortInterval = await call(
    'POST',
    '/api/monitors',
    { product: 'renewberry', name: 'Fast', url: 'https://status.example.com/', intervalSec: 5 },
    ops,
  );
  expect(
    'B-DOMAIN: monitors need Infrastructure:manage and interval ≥ 30 s',
    devCreate.status === 403 && shortInterval.status === 422,
    [devCreate.status, shortInterval.status],
  );

  // Outbound webhook subscribed to monitor.down, signed with HMAC.
  const conn = await call(
    'POST',
    '/api/integrations/webhook/connect',
    {
      name: 'Smoke receiver',
      url: 'https://hooks.example.com/devhq',
      events: ['monitor.down', 'incident.opened'],
    },
    admin,
  );
  const opsConn = await call(
    'POST',
    '/api/integrations/webhook/connect',
    { url: 'https://hooks.example.com/x' },
    ops,
  );
  const storedCred = engStore.integrations.get(conn.json.id as string)?.credential ?? '';
  expect(
    'B-DOMAIN: integration connect is Administration:manage; credential sealed at rest',
    conn.status === 201 &&
      opsConn.status === 403 &&
      typeof conn.json.signingSecret === 'string' &&
      storedCred.startsWith('v1.') &&
      !storedCred.includes('hooks.example.com'),
    conn.json,
  );

  const mon = await call(
    'POST',
    '/api/monitors',
    {
      product: 'renewberry',
      name: 'Smoke API',
      url: 'https://status.example.com/health',
      failureThreshold: 2,
    },
    ops,
  );
  const monId = mon.json.id as string;
  await call('POST', `/api/monitors/${monId}/check`, undefined, ops);
  const second = await call('POST', `/api/monitors/${monId}/check`, undefined, ops);
  const incId = (second.json.monitor as { openIncidentId?: string } | undefined)?.openIncidentId;
  const inc = incId
    ? await call('GET', `/api/incidents/${incId}`, undefined, ops)
    : { status: 0, json: {} as Record<string, unknown> };
  expect(
    'B-DOMAIN: consecutive monitor failures open an incident owned by Operations',
    mon.status === 201 &&
      (second.json.check as { status: string }).status === 'down' &&
      inc.status === 200 &&
      inc.json.owner === 'm11' &&
      inc.json.status === 'investigating' &&
      inc.json.product === 'renewberry',
    [second.json, inc.json],
  );

  await new Promise((r) => setTimeout(r, 300));
  const delivered = sent.find((s) => s.headers['x-devhq-event'] === 'monitor.down');
  expect(
    'B-DOMAIN: monitor.down delivered with a valid X-DevHQ-Signature',
    !!delivered &&
      delivered.url === 'https://hooks.example.com/devhq' &&
      outbound.verifyOutboundSignature(
        conn.json.signingSecret as string,
        delivered.body ?? '',
        delivered.headers['x-devhq-signature'],
      ) &&
      !outbound.verifyOutboundSignature(
        'wrong',
        delivered.body ?? '',
        delivered.headers['x-devhq-signature'],
      ),
    sent.map((s) => s.headers['x-devhq-event']),
  );
  const log = await call('GET', `/api/integrations/${conn.json.id}/webhooks`, undefined, admin);
  expect(
    'B-DOMAIN: delivery log records succeeded deliveries',
    (log.json.deliveries as { event: string; state: string }[]).some(
      (d) => d.event === 'monitor.down' && d.state === 'succeeded',
    ),
    log.json,
  );

  upstream = 200;
  await call('POST', `/api/monitors/${monId}/check`, undefined, ops);
  const resolved = await call('GET', `/api/incidents/${incId}`, undefined, ops);
  const checks = await call('GET', `/api/monitors/${monId}/checks`, undefined, ops);
  expect(
    'B-DOMAIN: recovery auto-resolves the incident; history and uptime are recorded',
    resolved.json.status === 'resolved' && checks.json.total === 3 && checks.json.uptime === 33.33,
    [resolved.json, checks.json],
  );
  restoreTransport();
  restoreDns();

  // GitHub App auth: RS256 JWT, cached installation token, ETag-conditional GETs.
  {
    const { generateKeyPairSync, createVerify } = await import('node:crypto');
    const gh = await import('../integrations/github/client.ts');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = '424242';
    // Container env files usually carry the PEM with literal "\n" escapes.
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: 'pkcs1', format: 'pem' })
      .toString()
      .replace(/\n/g, '\\n');
    const jwt = gh.appJwt();
    const [h, pl, sig] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(pl, 'base64url').toString()) as Record<string, unknown>;
    const jwtOk =
      createVerify('RSA-SHA256')
        .update(`${h}.${pl}`)
        .verify(publicKey, Buffer.from(sig, 'base64url')) &&
      claims.iss === '424242' &&
      Number(claims.exp) - Number(claims.iat) <= 600;
    const calls: { url: string; auth: string; inm?: string }[] = [];
    const restoreFetch = gh.setGithubFetch(async (url, init) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, auth: headers.authorization, inm: headers['if-none-match'] });
      if (url.endsWith('/access_tokens'))
        return new Response(
          JSON.stringify({
            token: 'ghs_smoke',
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      if (headers['if-none-match'] === '"v1"')
        return new Response(null, { status: 304, headers: { 'x-ratelimit-remaining': '4999' } });
      return new Response(JSON.stringify({ full_name: 'renewberry/api' }), {
        status: 200,
        headers: {
          etag: '"v1"',
          'x-ratelimit-remaining': '4998',
          'content-type': 'application/json',
        },
      });
    });
    const auth = { kind: 'installation' as const, installationId: 7 };
    const first = await gh.githubRequest<{ full_name: string }>('GET', '/repos/renewberry/api', {
      auth,
    });
    const again = await gh.githubRequest<{ full_name: string }>('GET', '/repos/renewberry/api', {
      auth,
    });
    restoreFetch();
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    expect(
      'B-DOMAIN: GitHub App JWT verifies (RS256); installation token cached; ETag 304 served from cache',
      jwtOk &&
        calls.filter((c) => c.url.endsWith('/access_tokens')).length === 1 &&
        calls[0].auth.startsWith('Bearer ') &&
        calls[1]?.auth === 'token ghs_smoke' &&
        calls[2]?.inm === '"v1"' &&
        first.full_name === 'renewberry/api' &&
        again.full_name === 'renewberry/api' &&
        gh.rateLimit.remaining === 4999,
      { jwtOk, calls },
    );
  }
  delete process.env.GITHUB_WEBHOOK_SECRET;
}

const audit = await call('GET', '/api/audit/verify', undefined, dev);
expect('audit chain intact', audit.json.ok === true, audit.json);

console.log(`\n${passed} checks passed`);
server.close();
process.exit(0);
