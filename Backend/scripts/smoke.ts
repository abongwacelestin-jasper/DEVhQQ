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
// STORAGE: fresh local object store per run (unused when S3_ENDPOINT points at MinIO).
process.env.STORAGE_LOCAL_DIR ??= `/tmp/devhq-smoke-objects-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      // CLI-style request (no Origin / Sec-Fetch-Site): the only kind that gets a body token.
      'X-DevHQ-Client': 'cli',
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

// ── STORAGE (wave 4): object storage, presigned uploads, backups, audit archive ──
{
  const { runSigV4Vectors } = await import('../storage/sigv4.test.ts');
  const vectors = runSigV4Vectors();
  expect(
    `storage: SigV4 signer matches all ${vectors.length} AWS test vectors`,
    vectors.length >= 8 && vectors.every((x) => x.ok),
    vectors.filter((x) => !x.ok),
  );

  const admin = (await call('POST', '/api/auth/demo', { role: 'admin' })).json.token as string;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(56, 7),
  ]);
  type Upload = { fileId: string; uploadUrl: string; headers: Record<string, string> };
  const putTo = (u: Upload, bytes: Buffer) =>
    fetch(u.uploadUrl, { method: 'PUT', headers: u.headers, body: bytes });
  const ask = (token: string, purpose: string, contentType: string, size: number, refId: string) =>
    call('POST', '/api/files/uploads', { purpose, contentType, size, name: 'f.bin', refId }, token);

  const req = await ask(dev, 'doc-attachment', 'image/png', png.length, 'doc-payments-spec');
  const up = req.json as unknown as Upload;
  expect(
    'storage: presigned upload issued for an in-scope doc',
    req.status === 201 &&
      typeof up.uploadUrl === 'string' &&
      up.headers['Content-Type'] === 'image/png',
    req.json,
  );
  const early = await call('POST', `/api/files/${up.fileId}/complete`, {}, dev);
  expect('storage: complete before upload is 409', early.status === 409, early.json);
  const put = await putTo(up, png);
  expect('storage: direct PUT to presigned URL accepted', put.ok, put.status);
  const done = await call('POST', `/api/files/${up.fileId}/complete`, {}, dev);
  expect(
    'storage: complete verifies size + magic bytes and marks ready',
    done.status === 200 && done.json.status === 'ready',
    done.json,
  );
  const dl = await call('GET', `/api/files/${up.fileId}`, undefined, dev);
  const got = dl.status === 200 ? await fetch(dl.json.url as string) : undefined;
  const gotBytes = got ? Buffer.from(await got.arrayBuffer()) : Buffer.alloc(0);
  expect(
    'storage: presigned GET returns the exact bytes, inline for images',
    dl.status === 200 &&
      dl.json.disposition === 'inline' &&
      gotBytes.equals(png) &&
      got?.headers.get('content-type') === 'image/png',
    dl.json,
  );

  const pdf = Buffer.from('%PDF-1.7\n% smoke\n');
  const pdfReq = await ask(dev, 'doc-attachment', 'application/pdf', pdf.length, 'doc-payments-spec');
  await putTo(pdfReq.json as unknown as Upload, pdf);
  await call('POST', `/api/files/${pdfReq.json.fileId}/complete`, {}, dev);
  const pdfDl = await call('GET', `/api/files/${pdfReq.json.fileId}`, undefined, dev);
  const pdfGet = await fetch(pdfDl.json.url as string);
  await pdfGet.arrayBuffer();
  expect(
    'storage: non-images download as attachment',
    pdfDl.json.disposition === 'attachment' &&
      (pdfGet.headers.get('content-disposition') ?? '').startsWith('attachment;'),
    pdfDl.json,
  );

  for (const contentType of ['text/html', 'image/svg+xml']) {
    const r = await ask(dev, 'doc-attachment', contentType, 10, 'doc-payments-spec');
    expect(`storage: ${contentType} upload refused (415)`, r.status === 415, r.json);
  }
  const big = await ask(dev, 'avatar', 'image/png', 3 * 1024 * 1024, 'm4');
  expect('storage: oversize avatar refused (413)', big.status === 413, big.json);

  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const liar = await ask(dev, 'doc-attachment', 'image/png', html.length, 'doc-payments-spec');
  const liarPut = await putTo(liar.json as unknown as Upload, html);
  expect('storage: disguised upload reaches storage', liarPut.ok, liarPut.status);
  const liarDone = await call('POST', `/api/files/${liar.json.fileId}/complete`, {}, dev);
  expect(
    'storage: magic-byte mismatch rejected',
    liarDone.status === 422 && (liarDone.json.error as { code: string }).code === 'type_mismatch',
    liarDone.json,
  );
  const short = await ask(dev, 'doc-attachment', 'image/png', 100, 'doc-payments-spec');
  const shortPut = await putTo(short.json as unknown as Upload, png);
  await shortPut.arrayBuffer();
  expect('storage: PUT of a size other than the signed one is refused', !shortPut.ok, shortPut.status);
  const cancel = await call('DELETE', `/api/files/${short.json.fileId}`, undefined, dev);
  expect('storage: pending upload can be cancelled', cancel.status === 204, cancel.json);

  const blogDoc = await call(
    'POST',
    '/api/docs',
    { projectId: 'p4', title: 'Storage smoke', kind: 'guide', visibility: 'project', body: 'x' },
    admin,
  );
  const blogDocId = blogDoc.json.id as string;
  const outReq = await ask(dev, 'doc-attachment', 'image/png', png.length, blogDocId);
  expect('storage: upload against an out-of-scope doc is 404', outReq.status === 404, outReq.json);
  const adminUp = await ask(admin, 'doc-attachment', 'image/png', png.length, blogDocId);
  await putTo(adminUp.json as unknown as Upload, png);
  await call('POST', `/api/files/${adminUp.json.fileId}/complete`, {}, admin);
  const outGet = await call('GET', `/api/files/${adminUp.json.fileId}`, undefined, dev);
  const outDel = await call('DELETE', `/api/files/${adminUp.json.fileId}`, undefined, dev);
  expect(
    'storage: out-of-scope file is 404 for read and delete',
    outGet.status === 404 && outDel.status === 404,
    [outGet.status, outDel.status],
  );
  const listed = await call('GET', '/api/files?refId=doc-payments-spec', undefined, dev);
  expect(
    'storage: attachments listed by resource',
    listed.status === 200 &&
      (listed.json.items as { id: string }[]).some((f) => f.id === up.fileId),
    listed.json,
  );

  const backup = await call('POST', '/api/backups', undefined, admin);
  const backupId = backup.json.id as string;
  expect(
    'storage: encrypted backup written to the backups bucket',
    backup.status === 201 &&
      /^bk-/.test(backupId) &&
      backup.json.encryption === 'aes-256-gcm' &&
      (backup.json.collections as Record<string, number>).files >= 2,
    backup.json,
  );
  const devRestore = await call('POST', `/api/backups/${backupId}/restore`, {}, dev);
  expect('storage: restore requires Administration:admin', devRestore.status === 403, devRestore.json);
  const dry = await call('POST', `/api/backups/${backupId}/restore`, {}, admin);
  const plan = (dry.json.plan ?? []) as { name: string; inBackup: number; unchanged: number }[];
  const filesPlan = plan.find((p) => p.name === 'files');
  expect(
    'storage: restore dry-run verifies, decrypts and diffs without writing',
    dry.status === 200 &&
      dry.json.dryRun === true &&
      dry.json.verified === true &&
      !!filesPlan &&
      filesPlan.inBackup >= 2 &&
      filesPlan.unchanged === filesPlan.inBackup,
    dry.json,
  );
  await call('DELETE', `/api/files/${pdfReq.json.fileId}`, undefined, dev);
  const noConfirm = await call('POST', `/api/backups/${backupId}/restore`, { dryRun: false }, admin);
  expect('storage: real restore needs explicit confirmation', noConfirm.status === 422, noConfirm.json);
  const real = await call(
    'POST',
    `/api/backups/${backupId}/restore`,
    { dryRun: false, confirm: backupId, collections: ['files'] },
    admin,
  );
  const back = await call('GET', '/api/files?refId=doc-payments-spec', undefined, dev);
  expect(
    'storage: real restore brings a deleted row back (after a safety backup)',
    real.status === 200 &&
      typeof real.json.safetyBackupId === 'string' &&
      (back.json.items as { id: string }[]).some((f) => f.id === pdfReq.json.fileId),
    real.json,
  );
  const drill = await call('POST', '/api/backups/drill', undefined, admin);
  expect('storage: restore drill passes on the encrypted backup', drill.json.ok === true, drill.json);

  const { flushAuditArchive, auditArchiveStatus } = await import('../storage/auditArchive.ts');
  await flushAuditArchive();
  const arch = auditArchiveStatus();
  expect(
    'storage: audit batch archived to the audit bucket with its chain head',
    arch.enabled &&
      arch.batches >= 1 &&
      arch.pending === 0 &&
      /^audit\/\d{4}\/\d{2}\/\d{2}\//.test(arch.lastKey),
    arch,
  );
}

// ===========================================================================
// SEC lane (wave 4) — token delivery, PATs, TOTP at rest, demo hardening,
// WebAuthn ceremonies, headers/CSP and the origin guard.
// ===========================================================================
{
  const { createHash, generateKeyPairSync, sign: signWith } = await import('node:crypto');
  const { totpAt } = await import('../auth/totp.ts');
  const { snapshot } = await import('../store/db.ts');
  const { personalAccessTokens } = await import('../security/pats.ts');
  const { seal, open: openSealed } = await import('../security/crypto.ts');
  const { config: appConfig } = await import('../config/env.ts');

  type Json = Record<string, unknown>;
  const errCode = (j: Json) => (j.error as { code?: string } | undefined)?.code;

  /** A browser-shaped request: same-origin fetch metadata + Origin, no bearer token. */
  async function browser(
    method: string,
    path: string,
    body?: unknown,
    opts: { cookie?: string; origin?: string; site?: string; client?: string } = {},
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'devhq-smoke',
        // The web app's origin (in the allow-list); the smoke server's own random port is not.
        Origin: opts.origin ?? appConfig.appOrigin,
        'Sec-Fetch-Site': opts.site ?? 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        ...(opts.client ? { 'X-DevHQ-Client': opts.client } : {}),
        ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      json: (text ? JSON.parse(text) : {}) as Json,
      cookies: res.headers.getSetCookie(),
      headers: res.headers,
    };
  }
  const cookieFrom = (setCookies: string[]) =>
    setCookies.find((c) => c.startsWith('__Host-devhq_session='))?.split(';')[0] ?? '';

  // --- 1. Token delivery ----------------------------------------------------
  const consoleStyle = await browser(
    'POST',
    '/api/auth/demo',
    { role: 'admin' },
    { client: 'console' },
  );
  const cliSpoof = await browser('POST', '/api/auth/demo', { role: 'admin' }, { client: 'cli' });
  const sessionCookie = cookieFrom(consoleStyle.cookies);
  expect(
    'SEC: browser-style sign-in gets an HttpOnly __Host- cookie and no token in the body',
    consoleStyle.status === 200 &&
      !('token' in consoleStyle.json) &&
      cliSpoof.status === 200 &&
      !('token' in cliSpoof.json) &&
      /HttpOnly/.test(consoleStyle.cookies.join(';')) &&
      /SameSite=Strict/.test(consoleStyle.cookies.join(';')) &&
      sessionCookie.length > 30,
    { consoleStyle: consoleStyle.json, cliSpoof: cliSpoof.json },
  );
  const cookieSession = await browser('GET', '/api/auth/session', undefined, {
    cookie: sessionCookie,
  });
  expect(
    'SEC: cookie-only session authenticates the browser',
    cookieSession.status === 200 &&
      (cookieSession.json.member as { id?: string } | undefined)?.id === 'm1',
    cookieSession.json,
  );

  // --- 2. Headers, CSP, cache ------------------------------------------------
  const h = (await fetch(`${base}/api/health`, { headers: { 'User-Agent': 'devhq-smoke' } }))
    .headers;
  const consoleHeaders = (
    await fetch(`${base}/console`, { headers: { 'User-Agent': 'devhq-smoke' } })
  ).headers;
  const consoleCspValue = consoleHeaders.get('content-security-policy') ?? '';
  expect(
    'SEC: API responses carry a deny-all CSP, no-store and isolation headers',
    (h.get('content-security-policy') ?? '').startsWith("default-src 'none'") &&
      /frame-ancestors 'none'/.test(h.get('content-security-policy') ?? '') &&
      h.get('cache-control') === 'no-store' &&
      h.get('cross-origin-opener-policy') === 'same-origin' &&
      h.get('cross-origin-resource-policy') === 'same-origin' &&
      h.get('cross-origin-embedder-policy') === 'require-corp' &&
      /camera=\(\)/.test(h.get('permissions-policy') ?? '') &&
      /publickey-credentials-get=\(self\)/.test(h.get('permissions-policy') ?? '') &&
      h.get('x-content-type-options') === 'nosniff',
    Object.fromEntries(h.entries()),
  );
  expect(
    'SEC: console HTML has a nonce CSP with no inline handlers, framing, plugins or base hijack',
    /script-src 'nonce-[A-Za-z0-9+/=]+'/.test(consoleCspValue) &&
      !/unsafe-eval/.test(consoleCspValue) &&
      /script-src-attr 'none'/.test(consoleCspValue) &&
      /frame-ancestors 'none'/.test(consoleCspValue) &&
      /object-src 'none'/.test(consoleCspValue) &&
      /base-uri 'none'/.test(consoleCspValue) &&
      consoleHeaders.get('cache-control') === 'no-store',
    consoleCspValue,
  );

  // --- 3. Origin guard -------------------------------------------------------
  const evilPost = await browser(
    'POST',
    '/api/auth/sign-in',
    { email: 'amara@techorg.io', password: 'devhq-demo' },
    { origin: 'https://evil.example', site: 'cross-site' },
  );
  const evilDelete = await browser('DELETE', '/api/auth/passkeys/abc', undefined, {
    origin: 'https://evil.example',
    site: 'cross-site',
    cookie: sessionCookie,
  });
  const nullOrigin = await browser(
    'PATCH',
    '/api/tasks/RB-212',
    { title: 'x' },
    {
      origin: 'null',
      site: 'cross-site',
      cookie: sessionCookie,
    },
  );
  const strippedOrigin = await fetch(`${base}/api/auth/sign-out`, {
    method: 'POST',
    headers: { 'User-Agent': 'devhq-smoke', 'Sec-Fetch-Site': 'cross-site', Cookie: sessionCookie },
  });
  expect(
    'SEC: origin guard rejects cross-site POST/DELETE/PATCH (incl. Origin: null and Origin stripped)',
    evilPost.status === 403 &&
      errCode(evilPost.json) === 'bad_origin' &&
      evilDelete.status === 403 &&
      nullOrigin.status === 403 &&
      strippedOrigin.status === 403,
    [evilPost.status, evilDelete.status, nullOrigin.status, strippedOrigin.status],
  );
  const preflight = await fetch(`${base}/api/tasks`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  expect('SEC: CORS preflight from an unknown origin is refused', preflight.status === 403);

  // --- 4. Personal access tokens --------------------------------------------
  const ownerCli = await call('POST', '/api/auth/demo', { role: 'admin' });
  const owner = ownerCli.json.token as string;
  expect(
    'SEC: explicit CLI client (no Origin / Sec-Fetch-Site) receives a bearer token',
    ownerCli.status === 200 && typeof owner === 'string' && owner.length > 40,
    ownerCli.json,
  );
  const tooLong = await call(
    'POST',
    '/api/tokens',
    { name: 'ci', scopes: ['project:view'], expiresInDays: 91 },
    owner,
  );
  const noExpiry = await call(
    'POST',
    '/api/tokens',
    { name: 'ci', scopes: ['project:view'] },
    owner,
  );
  const devOverScope = await call(
    'POST',
    '/api/tokens',
    { name: 'x', scopes: ['administration:view'], expiresInDays: 7 },
    dev,
  );
  expect(
    'SEC: PAT expiry is required (≤ 90 days) and scopes cannot exceed the role',
    tooLong.status === 422 &&
      noExpiry.status === 422 &&
      devOverScope.status === 422 &&
      errCode(devOverScope.json) === 'scope_exceeds_role',
    [tooLong.json, noExpiry.json, devOverScope.json],
  );
  const pat = await call(
    'POST',
    '/api/tokens',
    {
      name: 'smoke-ci',
      scopes: ['project:view', 'organization:view', 'infrastructure:admin'],
      expiresInDays: 30,
    },
    owner,
  );
  const patToken = pat.json.token as string;
  expect(
    'SEC: PAT is created once in dhq_pat_<id>_<secret> form and only its SHA-256 is stored',
    pat.status === 201 &&
      /^dhq_pat_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/.test(patToken) &&
      personalAccessTokens.get(pat.json.id as string)?.hash ===
        createHash('sha256').update(patToken).digest('hex') &&
      !JSON.stringify([...personalAccessTokens.values()]).includes(patToken.slice(25)),
    pat.json,
  );
  const patRead = await call('GET', '/api/tasks', undefined, patToken);
  const patWrite = await call(
    'POST',
    '/api/tasks',
    {
      projectId: 'p1',
      title: 'PAT write',
      type: 'task',
      priority: 'low',
      assignee: 'm4',
      due: '2026-11-30',
      estimate: 1,
    },
    patToken,
  );
  const patDeploys = await call('GET', '/api/deployments', undefined, patToken);
  expect(
    'SEC: PAT works and respects scope (project:view reads; writes and unscoped areas are 403)',
    patRead.status === 200 && patWrite.status === 403 && patDeploys.status === 403,
    [patRead.status, patWrite.status, patDeploys.status],
  );
  const patStepUp = await call('POST', '/api/backups', {}, patToken);
  const patMint = await call(
    'POST',
    '/api/tokens',
    { name: 'child', scopes: ['project:view'], expiresInDays: 1 },
    patToken,
  );
  const patTotp = await call('POST', '/api/auth/step-up', { code: '246810' }, patToken);
  expect(
    'SEC: PAT can never step up, mint tokens or use the step-up route',
    patStepUp.status === 403 &&
      errCode(patStepUp.json) === 'step_up_unavailable' &&
      patMint.status === 403 &&
      patTotp.status === 403,
    [patStepUp.json, patMint.json, patTotp.json],
  );
  const listed = await call('GET', '/api/tokens', undefined, owner);
  const listedItem = (listed.json.items as Json[]).find((t) => t.id === pat.json.id);
  expect(
    'SEC: token list records lastUsedAt and never returns the secret',
    listed.status === 200 &&
      typeof listedItem?.lastUsedAt === 'string' &&
      !JSON.stringify(listed.json).includes(patToken),
    listed.json,
  );
  const revoked = await call('DELETE', `/api/tokens/${pat.json.id as string}`, undefined, owner);
  const afterRevoke = await call('GET', '/api/tasks', undefined, patToken);
  expect(
    'SEC: revoked PAT is refused',
    revoked.status === 204 &&
      afterRevoke.status === 401 &&
      errCode(afterRevoke.json) === 'token_revoked',
    afterRevoke.json,
  );

  const testerCli = await call('POST', '/api/auth/demo', { role: 'tester' });
  const testerPat = await call(
    'POST',
    '/api/tokens',
    { name: 'tester-ci', scopes: ['project:view'], expiresInDays: 1 },
    testerCli.json.token as string,
  );
  const testerToken = testerPat.json.token as string;
  const beforeDeactivate = await call('GET', '/api/tasks', undefined, testerToken);
  const deactivate = await call('PATCH', '/api/team/m10', { status: 'deactivated' }, owner);
  const whileInactive = await call('GET', '/api/tasks', undefined, testerToken);
  const reactivate = await call('PATCH', '/api/team/m10', { status: 'active' }, owner);
  const afterReactivate = await call('GET', '/api/tasks', undefined, testerToken);
  expect(
    'SEC: deactivating a member revokes their PATs for good',
    beforeDeactivate.status === 200 &&
      deactivate.status === 200 &&
      whileInactive.status === 401 &&
      personalAccessTokens.get(testerPat.json.id as string)?.revokedReason === 'member_inactive' &&
      reactivate.status === 200 &&
      afterReactivate.status === 401 &&
      errCode(afterReactivate.json) === 'token_revoked',
    [beforeDeactivate.status, deactivate.json, whileInactive.json, afterReactivate.json],
  );

  // member.deactivated (published by B-COLLAB offboarding) revokes PATs and JIT grants.
  const { publish: publishEvent } = await import('../lib/events.ts');
  const { listGrants } = await import('../auth/jit.ts');
  const tester2 = (await call('POST', '/api/auth/demo', { role: 'tester' })).json.token as string;
  const designerPat = await call(
    'POST',
    '/api/tokens',
    { name: 'tester-ci-2', scopes: ['project:view'], expiresInDays: 1 },
    tester2,
  );
  const designerGrant = await call(
    'POST',
    '/api/access/grants',
    { scope: 'production:renewberry', reason: 'smoke: offboarding event test', durationMinutes: 15 },
    tester2,
  );
  publishEvent('member.deactivated', { memberId: 'm10', reason: 'smoke' });
  const designerAfter = await call('GET', '/api/tasks', undefined, designerPat.json.token as string);
  const eventAudit = await call('GET', '/api/audit?action=security.member_access_revoked', undefined, owner);
  expect(
    'SEC: member.deactivated event revokes the member’s PATs and JIT grants, audited',
    designerPat.status === 201 &&
      designerGrant.status === 200 &&
      personalAccessTokens.get(designerPat.json.id as string)?.revokedReason ===
        'member_deactivated:smoke' &&
      designerAfter.status === 401 &&
      listGrants().find((g) => g.id === designerGrant.json.id)?.status === 'denied' &&
      Array.isArray(eventAudit.json) &&
      (eventAudit.json as unknown as Json[]).some((e) => String(e.target).startsWith('m10 ·')),
    [designerPat.json, designerGrant.json, designerAfter.json, eventAudit.json],
  );

  // --- 5. TOTP enrollment, encryption at rest, demo hardening ----------------
  const yukiPw = await call('POST', '/api/auth/sign-in', {
    email: 'yuki@techorg.io',
    password: 'devhq-demo',
  });
  const yukiMfa = await call(
    'POST',
    '/api/auth/mfa/totp',
    { code: '246810' },
    yukiPw.json.token as string,
  );
  let yuki = yukiMfa.json.token as string;
  const enroll = await call('POST', '/api/auth/totp/enroll', {}, yuki);
  const secret = enroll.json.secret as string;
  expect(
    'SEC: TOTP enrollment returns an otpauth URI and the secret once',
    enroll.status === 201 &&
      /^[A-Z2-7]{32}$/.test(secret) &&
      String(enroll.json.otpauthUri).startsWith('otpauth://totp/') &&
      String(enroll.json.otpauthUri).includes(`secret=${secret}`),
    enroll.json,
  );
  const step = Math.floor(Date.now() / 30_000);
  const wrongConfirm = await call(
    'POST',
    '/api/auth/totp/confirm',
    { code: totpAt(secret, step - 5) },
    yuki,
  );
  const confirm = await call(
    'POST',
    '/api/auth/totp/confirm',
    { code: totpAt(secret, step) },
    yuki,
  );
  expect(
    'SEC: TOTP confirm needs a valid code, then stores the secret',
    wrongConfirm.status === 401 && confirm.status === 200,
    [wrongConfirm.json, confirm.json],
  );
  const stored = snapshot().members.find((m) => m.id === 'm7')?.totpSecret ?? '';
  const snapJson = JSON.stringify(snapshot());
  expect(
    'SEC: TOTP secret is AES-GCM sealed at rest — the plaintext never appears in a snapshot',
    stored.startsWith('enc:v1:') &&
      !snapJson.includes(secret) &&
      openSealed(stored, 'member:m7:totp') === secret,
    stored.slice(0, 20),
  );
  let openFailures = 0;
  for (const attempt of [
    () => openSealed(stored, 'member:m4:totp'), // wrong row
    () => openSealed(stored.slice(0, -4) + 'AAAA', 'member:m7:totp'), // tampered tag
  ]) {
    try {
      attempt();
    } catch {
      openFailures++;
    }
  }
  expect(
    'SEC: sealed values are bound to their context and tamper-evident',
    openFailures === 2 && openSealed(seal('x', 'c'), 'c') === 'x',
  );
  const demoStepUp = await call('POST', '/api/auth/step-up', { code: '246810' }, yuki);
  const replay = await call('POST', '/api/auth/step-up', { code: totpAt(secret, step) }, yuki);
  const yukiPw2 = await call('POST', '/api/auth/sign-in', {
    email: 'yuki@techorg.io',
    password: 'devhq-demo',
  });
  const demoMfa = await call(
    'POST',
    '/api/auth/mfa/totp',
    { code: '246810' },
    yukiPw2.json.token as string,
  );
  expect(
    'SEC: demo code is rejected for a TOTP-enrolled member (step-up and sign-in), and codes cannot replay',
    demoStepUp.status === 401 &&
      replay.status === 401 &&
      demoMfa.status === 401 &&
      (yukiPw2.json.methods as string[]).join() === 'totp',
    [demoStepUp.json, replay.json, demoMfa.json],
  );
  const realStepUp = await call(
    'POST',
    '/api/auth/step-up',
    { code: totpAt(secret, step + 1) },
    yuki,
  );
  yuki = (realStepUp.json.token as string) ?? yuki;
  expect('SEC: real TOTP code passes step-up', realStepUp.status === 200, realStepUp.json);

  // --- Production boot guards (fresh processes) -----------------------------
  const { spawnSync } = await import('node:child_process');
  const bootProd = (extra: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        "await import('./config/env.ts')",
      ],
      {
        cwd: new URL('..', import.meta.url).pathname,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'production',
          SESSION_SECRET: 'a'.repeat(64),
          APP_ORIGIN: 'https://app.devhq.test',
          WEBAUTHN_RP_ID: 'app.devhq.test',
          ...extra,
        },
        encoding: 'utf8',
      },
    );
  const prodOk = bootProd({ DATA_ENCRYPTION_KEY: 'b'.repeat(64) });
  const prodNoKey = bootProd({});
  const prodDemo = bootProd({ DATA_ENCRYPTION_KEY: 'b'.repeat(64), DEMO_MFA_CODE: '246810' });
  expect(
    'SEC: production boots with a data key, refuses without one, and refuses DEMO_* settings',
    prodOk.status === 0 &&
      prodNoKey.status !== 0 &&
      /DATA_ENCRYPTION_KEY/.test(prodNoKey.stderr) &&
      prodDemo.status !== 0 &&
      /DEMO_MFA_CODE/.test(prodDemo.stderr),
    [prodOk.stderr, prodNoKey.stderr.slice(0, 300), prodDemo.stderr.slice(0, 300)],
  );

  // --- 6. WebAuthn: register, step-up, passwordless sign-in, clone detection --
  const origin = appConfig.webauthnOrigins[0];
  const rpIdHash = createHash('sha256').update(appConfig.rpId).digest();
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = Buffer.from(createHash('sha256').update('smoke-credential').digest());
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y!, 'base64url'),
  ]);
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const clientData = (type: string, challenge: string, o = origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: o, crossOrigin: false })).toString(
      'base64url',
    );
  const regOpts = await call('POST', '/api/auth/passkeys/options', {}, yuki);
  const regPk = regOpts.json.publicKey as { challenge: string; rp: { id: string } };
  const attData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x45]), // UP | UV | AT
    u32(0),
    Buffer.alloc(16),
    Buffer.from([0, credId.length]),
    credId,
    cose,
  ]);
  const regBody = {
    challengeId: regOpts.json.challengeId,
    credentialId: credId.toString('base64url'),
    clientDataJSON: clientData('webauthn.create', regPk.challenge),
    authenticatorData: attData.toString('base64url'),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    algorithm: -7,
    label: 'Smoke key',
  };
  const registered = await call('POST', '/api/auth/passkeys', regBody, yuki);
  const reused = await call('POST', '/api/auth/passkeys', regBody, yuki);
  expect(
    'SEC: passkey registration verifies challenge, RP, flags and key binding; challenge is single use',
    regOpts.status === 200 &&
      regPk.rp.id === appConfig.rpId &&
      registered.status === 201 &&
      reused.status === 400 &&
      errCode(reused.json) === 'challenge_invalid',
    [regOpts.json, registered.json, reused.json],
  );

  const passkeyAssert = async (
    purpose: 'sign-in' | 'step-up',
    counter: number,
    token?: string,
    tweak: { origin?: string; flags?: number; badSig?: boolean } = {},
  ) => {
    const opts = await call('POST', '/api/auth/webauthn/options', { purpose }, token);
    const challenge = (opts.json.publicKey as { challenge: string }).challenge;
    const authData = Buffer.concat([rpIdHash, Buffer.from([tweak.flags ?? 0x05]), u32(counter)]);
    const cdj = clientData('webauthn.get', challenge, tweak.origin);
    const signed = Buffer.concat([
      authData,
      createHash('sha256').update(Buffer.from(cdj, 'base64url')).digest(),
    ]);
    const signature = signWith('sha256', tweak.badSig ? Buffer.from('nope') : signed, privateKey);
    return call(
      'POST',
      '/api/auth/webauthn/verify',
      {
        challengeId: opts.json.challengeId,
        credentialId: credId.toString('base64url'),
        clientDataJSON: cdj,
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: Buffer.from('m7').toString('base64url'),
      },
      token,
    );
  };
  const pkStepUp = await passkeyAssert('step-up', 1, yuki);
  yuki = (pkStepUp.json.token as string) ?? yuki;
  const wrongOrigin = await passkeyAssert('sign-in', 2, undefined, {
    origin: 'https://evil.example',
  });
  const noUv = await passkeyAssert('sign-in', 2, undefined, { flags: 0x01 });
  const badSig = await passkeyAssert('sign-in', 2, undefined, { badSig: true });
  const pkSignIn = await passkeyAssert('sign-in', 2);
  expect(
    'SEC: passkey step-up and passwordless sign-in verify origin, UV and the ES256 signature',
    pkStepUp.status === 200 &&
      pkStepUp.json.purpose === 'step-up' &&
      errCode(wrongOrigin.json) === 'origin_mismatch' &&
      errCode(noUv.json) === 'user_not_verified' &&
      errCode(badSig.json) === 'signature_invalid' &&
      pkSignIn.status === 200 &&
      typeof pkSignIn.json.token === 'string',
    [pkStepUp.json, wrongOrigin.json, noUv.json, badSig.json, pkSignIn.json],
  );
  const cloned = await passkeyAssert('sign-in', 2);
  const afterClone = await passkeyAssert('sign-in', 9);
  expect(
    'SEC: sign-count regression suspends the passkey',
    errCode(cloned.json) === 'counter_regressed' &&
      errCode(afterClone.json) === 'credential_suspended',
    [cloned.json, afterClone.json],
  );

  // --- 7. CYBER-001: /api/_events is filtered per subscriber -----------------
  const testerSse = (await call('POST', '/api/auth/demo', { role: 'tester' })).json.token as string;
  const sseAbort = new AbortController();
  const sseRes = await fetch(`${base}/api/_events`, {
    headers: { Authorization: `Bearer ${testerSse}`, 'User-Agent': 'devhq-smoke' },
    signal: sseAbort.signal,
  });
  const sseTypes: { type: string; data: string }[] = [];
  const sseDone = (async () => {
    const reader = sseRes.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const type = /^event: (.+)$/m.exec(chunk)?.[1];
          if (type) sseTypes.push({ type, data: /^data: (.+)$/m.exec(chunk)?.[1] ?? '' });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  await new Promise((r) => setTimeout(r, 100));
  // Generates audit + signin events, a blog task event and a renewberry task event.
  await call('POST', '/api/auth/demo', { role: 'pm' });
  const blogPatch = await call('PATCH', '/api/tasks/BL-17', { priority: 'low' }, owner);
  const rbPatch = await call('PATCH', '/api/tasks/RB-212', { priority: 'high' }, owner);
  await new Promise((r) => setTimeout(r, 300));
  sseAbort.abort();
  await sseDone;
  const leaked = sseTypes.filter(
    (e) => e.type === 'audit' || e.type === 'signin' || e.data.includes('BL-17'),
  );
  expect(
    'SEC: _events gives a Tester no audit/signin events and nothing from the blog product',
    sseRes.status === 200 &&
      blogPatch.status === 200 &&
      rbPatch.status === 200 &&
      leaked.length === 0 &&
      sseTypes.some((e) => e.type === 'task' && e.data.includes('RB-212')),
    { leaked, types: sseTypes.map((e) => e.type) },
  );

  // --- 8. CYBER-004: prototype keys are rejected, not silently dropped ---------
  const rawPost = async (path: string, method: string, body: string) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'devhq-smoke',
        Authorization: `Bearer ${dev}`,
      },
      body,
    });
    return { status: res.status, json: (await res.json()) as Json };
  };
  const protoBody = await rawPost(
    '/api/tasks/RB-212',
    'PATCH',
    '{"__proto__":{"role":"Owner"},"priority":"low"}',
  );
  const ctorBody = await rawPost('/api/tasks/RB-212', 'PATCH', '{"constructor":1}');
  const toStringBody = await rawPost('/api/tasks/RB-212', 'PATCH', '{"toString":1}');
  expect(
    'SEC: validator rejects __proto__ / constructor / inherited keys with 422',
    protoBody.status === 422 && ctorBody.status === 422 && toStringBody.status === 422,
    [protoBody.json, ctorBody.json, toStringBody.json],
  );
}

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

// ───────────────────────── B-COLLAB (wave 4) ─────────────────────────
// Messaging + realtime isolation, mentions → notifications, onboarding stages,
// password recovery, offboarding step-up, doc versions, mail transport.
{
  type Json = Record<string, unknown>;
  const mail = await import('../mail/index.ts');
  const { smtpTransport } = await import('../mail/smtp.ts');
  const { recoveryEmail } = await import('../mail/templates.ts');
  const { RECOVERY_MIN_MS } = await import('../routes/recovery.routes.ts');
  const net = await import('node:net');
  const outbox = mail.memoryTransport();
  mail.setMailTransport(outbox);

  async function req(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    headers: Record<string, string> = {},
  ) {
    const started = Date.now();
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-DevHQ-Client': 'cli', // SEC: body tokens only for CLI-style requests
        'User-Agent': 'devhq-smoke',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      ms: Date.now() - started,
      text,
      json: (text ? JSON.parse(text) : {}) as Json,
    };
  }
  const code = (r: { json: Json }) => (r.json.error as { code?: string } | undefined)?.code;
  const demo = async (role: string) =>
    (await req('POST', '/api/auth/demo', { role })).json.token as string;
  async function passwordSignIn(email: string, password: string) {
    const step1 = await req('POST', '/api/auth/sign-in', { email, password });
    if (step1.status !== 200) return { status: step1.status, token: '' };
    const step2 = await req(
      'POST',
      '/api/auth/mfa/totp',
      { code: '246810' },
      step1.json.token as string,
    );
    return { status: step2.status, token: step2.json.token as string };
  }
  async function stream(path: string, token: string) {
    const ac = new AbortController();
    const res = await fetch(base + path, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'devhq-smoke' },
      signal: ac.signal,
    });
    const events: { type: string; data: Json }[] = [];
    let rawText = '';
    const reader = res.body!.getReader();
    void (async () => {
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value).toString('utf8');
          rawText += chunk;
          buf += chunk;
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const type = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (type && data) events.push({ type, data: JSON.parse(data) as Json });
          }
        }
      } catch {
        /* aborted */
      }
    })();
    return { status: res.status, events, raw: () => rawText, close: () => ac.abort() };
  }
  const waitFor = async (cond: () => boolean, ms = 2_000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    return cond();
  };

  const owner = await demo('admin'); // m1
  const devC = await demo('developer'); // m4
  const designer = await demo('designer'); // m9
  const pm = await demo('pm'); // m2

  // Messaging + SSE isolation
  const chans = await req('GET', '/api/channels', undefined, designer);
  const visibleIds = ((chans.json.items as { id: string }[]) ?? []).map((c) => c.id);
  expect(
    'collab: channel list hides private channels and DMs from non-members',
    chans.status === 200 &&
      visibleIds.includes('general') &&
      !visibleIds.includes('incidents') &&
      !visibleIds.includes('dm-m1-m4'),
    visibleIds,
  );
  const hiddenMsgs = await req('GET', '/api/channels/incidents/messages', undefined, designer);
  expect('collab: private channel messages are 404 to non-members', hiddenMsgs.status === 404);

  const ownerStream = await stream('/api/stream', owner);
  const outsiderStream = await stream('/api/stream', designer);
  const outsiderBus = await stream('/api/_events', designer);
  await waitFor(
    () =>
      ownerStream.events.some((e) => e.type === 'hello') &&
      outsiderStream.events.some((e) => e.type === 'hello'),
  );
  const secret = `smoke-secret-${Date.now()} rollback plan for @m1`;
  const posted = await req('POST', '/api/channels/incidents/messages', { text: secret }, devC);
  expect(
    'collab: member posts a message (stored as-is, mention parsed)',
    posted.status === 201 &&
      posted.json.text === secret &&
      (posted.json.mentions as string[])?.includes('m1'),
    posted.json,
  );
  const delivered = await waitFor(() =>
    ownerStream.events.some(
      (e) => e.type === 'message.created' && (e.data.data as Json)?.id === posted.json.id,
    ),
  );
  expect(
    'collab: SSE delivers the message to a channel member',
    delivered,
    ownerStream.events.map((e) => e.type),
  );
  await new Promise((r) => setTimeout(r, 250));
  expect(
    'collab: SSE does not deliver the message to a non-member',
    outsiderStream.status === 200 && !outsiderStream.raw().includes(secret.slice(0, 20)),
  );
  expect(
    'collab: global /api/_events never carries message bodies',
    outsiderBus.status === 200 && !outsiderBus.raw().includes(secret.slice(0, 20)),
  );
  expect(
    'collab: mention notification pushed to the mentioned member only',
    (await waitFor(() => ownerStream.events.some((e) => e.type === 'notification.created'))) &&
      !outsiderStream.events.some((e) => e.type === 'notification.created'),
  );
  ownerStream.close();
  outsiderStream.close();
  outsiderBus.close();

  const notes = await req('GET', '/api/notifications?unread=1', undefined, owner);
  const mention = ((notes.json.items as Json[]) ?? []).find(
    (n) => n.refId === `message:${posted.json.id}`,
  );
  expect(
    'collab: mention creates a notification',
    notes.status === 200 && mention?.kind === 'mention',
    notes.json,
  );
  const markRead = await req('POST', '/api/notifications/read', { ids: [mention?.id] }, owner);
  expect(
    'collab: notification marked read',
    markRead.status === 200 && markRead.json.updated === 1,
    markRead.json,
  );

  const page = await req('GET', '/api/channels/rb-v2-4/messages?limit=2', undefined, devC);
  const older = await req(
    'GET',
    `/api/channels/rb-v2-4/messages?limit=2&before=${page.json.nextCursor}`,
    undefined,
    devC,
  );
  const ids1 = ((page.json.items as Json[]) ?? []).map((m) => m.id);
  const ids2 = ((older.json.items as Json[]) ?? []).map((m) => m.id);
  expect(
    'collab: cursor pagination returns disjoint older pages',
    page.status === 200 &&
      ids1.length === 2 &&
      typeof page.json.nextCursor === 'string' &&
      ids2.length === 2 &&
      !ids2.some((id) => ids1.includes(id)),
    { ids1, ids2 },
  );
  const reply = await req(
    'POST',
    '/api/channels/incidents/messages',
    { text: 'thread reply', parentId: posted.json.id },
    owner,
  );
  const thread = await req(
    'GET',
    `/api/channels/incidents/messages?thread=${posted.json.id}`,
    undefined,
    devC,
  );
  expect(
    'collab: thread reply lands in the thread',
    reply.status === 201 &&
      reply.json.threadOf === posted.json.id &&
      (thread.json.items as Json[])?.length === 1,
    thread.json,
  );
  const react = await req(
    'POST',
    `/api/messages/${posted.json.id}/reactions`,
    { emoji: '👀' },
    owner,
  );
  const pin = await req('POST', `/api/messages/${posted.json.id}/pin`, {}, owner);
  expect(
    'collab: reactions and pins',
    react.status === 200 &&
      (react.json.reactions as Record<string, string[]>)['👀']?.includes('m1') &&
      pin.json.pinned === true,
    [react.json, pin.json],
  );
  const foreignEdit = await req(
    'PATCH',
    `/api/messages/${posted.json.id}`,
    { text: 'hijack' },
    owner,
  );
  const del = await req('DELETE', `/api/messages/${posted.json.id}`, undefined, owner);
  expect(
    'collab: only the author edits; channel admin deletes to a tombstone',
    foreignEdit.status === 403 &&
      del.status === 200 &&
      del.json.deleted === true &&
      del.json.text === '' &&
      !del.json.pinned,
    [foreignEdit.status, del.json],
  );
  const poll = await req(
    'POST',
    '/api/channels/rb-v2-4/messages',
    { kind: 'poll', poll: { question: 'Smoke?', options: ['yes', 'no'] } },
    devC,
  );
  const vote = await req('POST', `/api/messages/${poll.json.id}/vote`, { option: 1 }, pm);
  expect(
    'collab: polls accept votes',
    vote.status === 200 &&
      (vote.json.poll as { options: { votes: string[] }[] }).options[1].votes.includes('m2'),
    vote.json,
  );
  const tooLong = await req(
    'POST',
    '/api/channels/rb-v2-4/messages',
    { text: 'x'.repeat(4_001) },
    devC,
  );
  const announce = await req(
    'POST',
    '/api/channels/general/messages',
    { text: 'not an admin' },
    devC,
  );
  expect(
    'collab: length cap and post policy enforced',
    tooLong.status === 422 && announce.status === 403,
  );
  const dm = await req('POST', '/api/channels', { kind: 'dm', members: ['m9'] }, pm);
  const burstStatuses: number[] = [];
  for (let i = 0; i < 22; i++)
    burstStatuses.push(
      (await req('POST', `/api/channels/${dm.json.id}/messages`, { text: `burst ${i}` }, pm))
        .status,
    );
  expect(
    'collab: message posting is rate-limited per member',
    dm.status === 201 &&
      burstStatuses.slice(0, 20).every((s) => s === 201) &&
      burstStatuses.includes(429),
    burstStatuses,
  );

  // Workspaces
  const wsDenied = await req(
    'POST',
    '/api/workspaces',
    { name: 'Smoke', slug: 'smoke-ws', template: 'startup' },
    pm,
  );
  const ws = await req(
    'POST',
    '/api/workspaces',
    { name: 'Smoke', slug: `smoke-${Date.now()}`, template: 'startup', members: ['m4'] },
    owner,
  );
  const wsList = await req('GET', '/api/workspaces', undefined, devC);
  const wsHidden = await req('GET', `/api/workspaces/${ws.json.id}`, undefined, designer);
  expect(
    'collab: workspaces — Organization:admin creates, members see, others 404',
    wsDenied.status === 403 &&
      ws.status === 201 &&
      ((wsList.json.items as Json[]) ?? []).some((w) => w.id === ws.json.id) &&
      wsHidden.status === 404,
    [wsDenied.status, ws.status, wsHidden.status],
  );

  // Onboarding
  const ob0 = await req('GET', '/api/onboarding', undefined, designer);
  const profileBody = {
    displayName: 'Inès Moreau',
    timezone: 'Europe/Berlin (CET)',
    hoursFrom: '09:00',
    hoursTo: '17:00',
    skills: ['Figma'],
    notify: ['mentions'],
  };
  const earlyProfile = await req('POST', '/api/onboarding/profile', profileBody, designer);
  const wrongName = await req(
    'POST',
    '/api/onboarding/nda',
    { version: '3.3', signedName: 'Someone Else' },
    designer,
  );
  const signed = await req(
    'POST',
    '/api/onboarding/nda',
    { version: '3.3', signedName: 'inès moreau' },
    designer,
  );
  expect(
    'collab: NDA sign moves the stage nda → profile',
    ob0.json.stage === 'nda' &&
      wrongName.status === 422 &&
      signed.status === 201 &&
      signed.json.stage === 'profile' &&
      typeof (signed.json.signature as Json)?.textHash === 'string',
    [ob0.json.stage, wrongName.status, signed.json],
  );
  expect(
    'collab: profile is refused before the NDA',
    earlyProfile.status === 409 && code(earlyProfile) === 'nda_required',
  );
  const ready = await req('POST', '/api/onboarding/profile', profileBody, designer);
  const ownerStage = await req('GET', '/api/onboarding', undefined, owner);
  expect(
    'collab: profile is required before ready (Owner needs no onboarding)',
    ready.status === 200 &&
      ready.json.stage === 'ready' &&
      ownerStage.json.stage === 'ready' &&
      ownerStage.json.required === false,
    [ready.json, ownerStage.json],
  );

  // Recovery
  const lena = await passwordSignIn('lena@techorg.io', 'devhq-demo');
  outbox.outbox.length = 0;
  const known = await req('POST', '/api/auth/recovery/request', { email: 'lena@techorg.io' });
  const unknownReq = await req('POST', '/api/auth/recovery/request', {
    email: 'nobody-here@techorg.io',
  });
  expect(
    'collab: recovery request — identical status, body and timing bucket (no enumeration)',
    known.status === 202 &&
      unknownReq.status === 202 &&
      known.text === unknownReq.text &&
      known.ms >= RECOVERY_MIN_MS &&
      unknownReq.ms >= RECOVERY_MIN_MS &&
      Math.abs(known.ms - unknownReq.ms) < 100,
    [known.status, unknownReq.status, known.ms, unknownReq.ms],
  );
  const resetMail = outbox.outbox.find((m) => m.to === 'lena@techorg.io');
  const resetToken =
    /reset-password\?token=([A-Za-z0-9_-]+)/.exec(resetMail?.text ?? '')?.[1] ?? '';
  expect(
    'collab: exactly one reset email, for the real account, linking APP_ORIGIN',
    outbox.outbox.length === 1 &&
      resetToken.length >= 40 &&
      !!resetMail?.html.includes('Choose a new password'),
    outbox.outbox.map((m) => m.to),
  );
  const weak = await req('POST', '/api/auth/recovery/reset', {
    token: resetToken,
    password: 'short',
  });
  const newPassword = 'Smoke-Reset-2026!x';
  const reset = await req('POST', '/api/auth/recovery/reset', {
    token: resetToken,
    password: newPassword,
  });
  const reuse = await req('POST', '/api/auth/recovery/reset', {
    token: resetToken,
    password: newPassword,
  });
  expect(
    'collab: reset applies the password policy and the token is single-use',
    weak.status === 422 &&
      reset.status === 200 &&
      reuse.status === 400 &&
      code(reuse) === 'reset_invalid',
    [weak.status, reset.json, reuse.status],
  );
  const oldSession = await req('GET', '/api/auth/session', undefined, lena.token);
  const newLogin = await passwordSignIn('lena@techorg.io', newPassword);
  expect(
    'collab: sessions revoked after reset; new password works',
    lena.status === 200 &&
      oldSession.status === 401 &&
      (reset.json.revokedSessions as number) >= 1 &&
      newLogin.status === 200,
    [oldSession.status, reset.json.revokedSessions, newLogin.status],
  );

  // Offboarding needs step-up
  const prevTrust = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  const away = { 'X-Forwarded-For': '127.0.0.2' };
  const sam = await passwordSignIn('sam@techorg.io', 'devhq-demo'); // m8
  const startBody = { lastDay: '2026-12-31', reason: 'Smoke test', handoverTo: 'm6' };
  const devTry = await req('POST', '/api/offboarding/m8', startBody, devC);
  const stale = await req('POST', '/api/offboarding/m8', startBody, owner, away);
  const stepped = await req('POST', '/api/auth/step-up', { code: '246810' }, owner, away);
  const fresh = stepped.json.token as string;
  const started = await req('POST', '/api/offboarding/m8', startBody, fresh, away);
  expect(
    'collab: offboarding needs Administration:manage and a fresh step-up',
    devTry.status === 403 &&
      stale.status === 401 &&
      code(stale) === 'step_up_required' &&
      stepped.status === 200 &&
      started.status === 201,
    [devTry.status, stale.status, code(stale), stepped.status, started.status],
  );
  const step = await req(
    'PATCH',
    '/api/offboarding/m8',
    { step: { id: 'docs', done: true } },
    fresh,
    away,
  );
  const done = await req('PATCH', '/api/offboarding/m8', { status: 'completed' }, fresh, away);
  const samAfter = await req('GET', '/api/auth/session', undefined, sam.token);
  process.env.TRUST_PROXY = prevTrust;
  if (prevTrust === undefined) delete process.env.TRUST_PROXY;
  expect(
    'collab: completing offboarding deactivates the member and revokes sessions',
    step.status === 200 &&
      done.status === 200 &&
      done.json.status === 'completed' &&
      sam.status === 200 &&
      samAfter.status === 401,
    [step.status, done.json, samAfter.status],
  );

  // Doc versions + comments
  const docId = 'doc-payments-spec';
  const baseline = await req(
    'POST',
    `/api/docs/${docId}/versions`,
    { summary: 'Smoke baseline' },
    pm,
  );
  const original = (await req('GET', `/api/docs/${docId}`, undefined, pm)).json.body as string;
  const edited = await req(
    'PATCH',
    `/api/docs/${docId}`,
    { body: `${original}\n- Smoke edit` },
    pm,
  );
  const history = await req('GET', `/api/docs/${docId}/versions`, undefined, pm);
  const diff = await req(
    'GET',
    `/api/docs/${docId}/versions/${baseline.json.id}/diff`,
    undefined,
    pm,
  );
  const restored = await req(
    'POST',
    `/api/docs/${docId}/versions/${baseline.json.id}/restore`,
    {},
    pm,
  );
  const after = await req('GET', `/api/docs/${docId}`, undefined, pm);
  expect(
    'collab: doc version restore (publish snapshot, diff, restore)',
    baseline.status === 201 &&
      edited.status === 200 &&
      (history.json.items as Json[]).length >= 2 &&
      diff.json.added === 1 &&
      restored.status === 200 &&
      after.json.body === original,
    [baseline.status, (history.json.items as Json[])?.length, diff.json.added, restored.status],
  );
  const restrictedVersions = await req(
    'GET',
    '/api/docs/doc-api-runbook/versions',
    undefined,
    designer,
  );
  const comment = await req(
    'POST',
    `/api/docs/${docId}/comments`,
    { text: 'Is retry capped?', anchor: { quote: 'Retry with backoff' } },
    designer,
  );
  const resolved = await req(
    'PATCH',
    `/api/docs/${docId}/comments/${comment.json.id}`,
    { resolved: true },
    pm,
  );
  const pmNotes = await req('GET', '/api/notifications?kind=doc-comment', undefined, pm);
  expect(
    'collab: doc comments anchor, resolve and notify editors; restricted docs stay 404',
    restrictedVersions.status === 404 &&
      comment.status === 201 &&
      resolved.json.resolved === true &&
      ((pmNotes.json.items as Json[]) ?? []).some(
        (n) => n.refId === `doc-comment:${comment.json.id}`,
      ),
    [restrictedVersions.status, comment.status, resolved.json],
  );

  // Mail: escaping and a real SMTP conversation (in-process fake server)
  const tpl = recoveryEmail(
    '<script>x</script>',
    'https://app.example/reset-password?token=abc',
    30,
  );
  expect(
    'collab: mail templates escape HTML and include a text part',
    tpl.html.includes('&lt;script&gt;') &&
      !tpl.html.includes('<script>') &&
      tpl.text.includes('token=abc'),
  );
  let received = '';
  const smtpServer = net.createServer((sock) => {
    let data = false;
    let buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') {
            data = false;
            sock.write('250 queued\r\n');
          } else received += line + '\n';
          continue;
        }
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (verb === 'AUTH')
          sock.write(
            Buffer.from(line.split(' ')[2] ?? '', 'base64').toString() === '\0u\0p'
              ? '235 ok\r\n'
              : '535 no\r\n',
          );
        else if (verb === 'DATA') {
          data = true;
          sock.write('354 go\r\n');
        } else if (verb === 'QUIT') sock.end('221 bye\r\n');
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((r) => smtpServer.listen(0, '127.0.0.1', r));
  const smtpPort = (smtpServer.address() as AddressInfo).port;
  const msg = { to: 'kofi@techorg.io', ...tpl };
  let strictRefused = false;
  try {
    await smtpTransport({
      host: '127.0.0.1',
      port: smtpPort,
      from: 'DevHQ <no-reply@devhq.app>',
      timeoutMs: 3_000,
    }).send(msg);
  } catch (e) {
    strictRefused = String(e).includes('STARTTLS');
  }
  await smtpTransport({
    host: '127.0.0.1',
    port: smtpPort,
    user: 'u',
    password: 'p',
    from: 'DevHQ <no-reply@devhq.app>',
    requireTls: false,
    timeoutMs: 3_000,
  }).send(msg);
  smtpServer.close();
  expect(
    'collab: SMTP transport refuses plaintext by default, delivers multipart mail with AUTH',
    strictRefused &&
      received.includes('Content-Type: multipart/alternative') &&
      received.includes('Content-Type: text/html'),
    received.slice(0, 300),
  );
  mail.setMailTransport(undefined);

  const chain = await call('GET', '/api/audit/verify', undefined, fresh);
  expect(
    'collab: audit chain intact after collaboration writes',
    chain.json.ok === true,
    chain.json,
  );
}

// ── B-DATA: persistence seam (memory mode; Postgres is covered by `npm run smoke:pg`) ──
if (!process.env.DATABASE_URL) {
  const { persistenceStatus, registeredCollections, setDriver } =
    await import('../store/collection.ts');
  expect(
    'persistence runs in memory mode without DATABASE_URL',
    persistenceStatus().mode === 'memory',
  );
  expect(
    'core tables, sessions, sign-ins and JIT grants are persisted collections',
    ['members', 'tasks', 'taskComments', 'sessions', 'signIns', 'jitGrants'].every((n) =>
      registeredCollections().includes(n),
    ),
    registeredCollections(),
  );
  const writes: string[] = [];
  setDriver({
    write: (c, k, v) => void writes.push(`${c}/${k}/${(v as { status?: string }).status ?? ''}`),
    remove: (c, k) => void writes.push(`-${c}/${k}`),
    load: async () => [],
  });
  const patched = await call('PATCH', `/api/tasks/${newKey}`, { status: 'review' }, dev);
  expect(
    'in-place task update reaches the persistence driver (save after mutation)',
    patched.status === 200 && writes.includes(`tasks/${newKey}/review`),
    writes,
  );
  const fresh = await call('POST', '/api/auth/demo', { role: 'pm' });
  const freshToken = String(fresh.json.token);
  const rawId = freshToken.slice(0, freshToken.lastIndexOf('.'));
  const sessionRows = writes.filter((w) => w.startsWith('sessions/'));
  expect(
    'session rows are keyed by an opaque handle, never the bearer token',
    fresh.status === 200 && sessionRows.length > 0 && sessionRows.every((w) => !w.includes(rawId)),
    sessionRows,
  );
  setDriver({ write() {}, remove() {}, load: async () => [] });
}

console.log(`\n${passed} checks passed`);
server.close();
process.exit(0);
