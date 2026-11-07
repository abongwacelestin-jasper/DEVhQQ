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
expect(
  'comment recorded',
  comment.status === 201 && comment.json.taskKey === newKey,
  comment.json,
);
const subtask = await call('POST', `/api/tasks/${newKey}/subtasks`, { title: 'Smoke subtask' }, dev);
expect('subtask added', subtask.status === 201, subtask.json);
const completed = await call(
  'PATCH',
  `/api/tasks/${newKey}/subtasks/${subtask.json.id}`,
  { done: true },
  dev,
);
expect('subtask completed', completed.status === 200 && completed.json.done === true, completed.json);
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
        'X-DevHQ-Client': 'console',
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
