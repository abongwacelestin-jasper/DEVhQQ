/**
 * Multi-replica proof for the relational data layer (ADR 0011), run by
 * `npm run smoke:pg` after its restart phases. Requires DATABASE_URL.
 *
 *   backfill  — empties the relational tables (the JSONB `documents` copy
 *               stays, as on the first boot after upgrading), runs the
 *               backfill twice and checks it restores every row and is
 *               idempotent (second run inserts nothing).
 *   replicas  — starts TWO API processes on the same database and, for every
 *               migrated collection, writes through one and reads through the
 *               other: members (invite, role change), sessions (sign in on A,
 *               use on B, revoke on B, rejected on A), tasks (create on A,
 *               patch on B, read on A), task events and comments, and
 *               notifications (created on A, read and marked read on B).
 *
 *   node --experimental-strip-types db/smoke-replicas.ts            (both)
 *   node --experimental-strip-types db/smoke-replicas.ts serve      (one replica; prints PORT n)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('smoke-replicas needs DATABASE_URL');
  process.exit(2);
}

// ── one replica ─────────────────────────────────────────────────────────────
if (process.argv[2] === 'serve') {
  process.env.AUDIT_LOG_FILE = `/tmp/devhq-smoke-replica-${process.pid}.jsonl`;
  const { buildApp } = await import('../server.ts');
  const router = await buildApp();
  const server = createServer((req, res) => void router.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  console.log(`PORT ${(server.address() as AddressInfo).port}`);
  const stop = async () => {
    server.close();
    const { closePersistence } = await import('./boot.ts');
    await closePersistence().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  // Keep running until the orchestrator stops us.
  await new Promise(() => undefined);
}

let failed = false;
function expect(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`✓ ${name}`);
  else {
    failed = true;
    console.log(`✗ ${name}`);
    console.error(`✗ ${name}`, JSON.stringify(detail ?? '').slice(0, 2000));
  }
}

// ── backfill ────────────────────────────────────────────────────────────────
{
  const { default: pg } = await import('pg');
  const { backfill, formatReport } = await import('./backfill.ts');
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const tables = ['notifications', 'task_comments', 'task_events', 'tasks', 'sessions', 'members'];
  const before: Record<string, number> = {};
  for (const t of tables)
    before[t] = Number(
      (await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`)).rows[0].n,
    );
  // The dual-write mirror kept `documents` in step, so it can rebuild the tables.
  await pool.query(`TRUNCATE ${tables.join(', ')}`);
  const first = await backfill(pool);
  for (const r of first) console.log(`  ${formatReport(r)}`);
  const after: Record<string, number> = {};
  for (const t of tables)
    after[t] = Number(
      (await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`)).rows[0].n,
    );
  expect(
    'backfill restores every migrated row from the JSONB documents and verifies counts',
    first.every((r) => r.ok && r.missing === r.skipped) &&
      tables.every((t) => after[t] === before[t]) &&
      after.members > 0 &&
      after.tasks > 0,
    { before, after, first },
  );
  const second = await backfill(pool);
  expect(
    'backfill is idempotent (a second run inserts nothing)',
    second.every((r) => r.ok && r.inserted === 0),
    second.map(formatReport),
  );
  await pool.end();
}

// ── two replicas ────────────────────────────────────────────────────────────
function startReplica(name: string): Promise<{ base: string; child: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', self, 'serve'], {
      env: { ...process.env, LOG_LEVEL: 'error', JOBS_IN_PROCESS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => reject(new Error(`${name} did not start: ${err}`)), 60_000);
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      const m = /PORT (\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ base: `http://127.0.0.1:${m[1]}`, child });
      }
    });
    child.stderr!.on('data', (d: Buffer) => (err += d.toString()));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${name} exited ${code}: ${err.slice(-2000)}`));
    });
  });
}

type Json = Record<string, unknown>;
let ipN = 10;
function client(base: string, ip = `198.18.0.${ipN++}`) {
  return async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-DevHQ-Client': 'cli',
        'User-Agent': 'devhq-smoke-replicas',
        'X-Forwarded-For': ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? (JSON.parse(text) as Json) : {};
    } catch {
      /* not JSON */
    }
    return { status: res.status, json };
  };
}

const a = await startReplica('A');
const b = await startReplica('B');
try {
  // The same client (IP + UA) talks to both replicas: a session is bound to them.
  const ip = '198.18.1.1';
  const onA = client(a.base, ip);
  const onB = client(b.base, ip);

  // ── sessions ──
  const demo = await onA('POST', '/api/auth/demo', { role: 'admin' });
  const owner = String(demo.json.token);
  const whoB = await onB('GET', '/api/auth/session', undefined, owner);
  expect(
    'sessions: a session created on replica A authenticates on replica B',
    demo.status === 200 && whoB.status === 200,
    [demo.json, whoB.json],
  );
  const pmA = String((await onA('POST', '/api/auth/demo', { role: 'pm' })).json.token);
  const devA = String((await onA('POST', '/api/auth/demo', { role: 'developer' })).json.token);
  const doomed = String((await onA('POST', '/api/auth/demo', { role: 'tester' })).json.token);
  const outB = await onB('POST', '/api/auth/sign-out', undefined, doomed);
  const afterA = await onA('GET', '/api/auth/session', undefined, doomed);
  expect(
    'sessions: signing out on replica B ends the session on replica A at once',
    outB.status === 204 && afterA.status === 401,
    [outB.status, afterA.json],
  );

  // ── members ──
  const email = `replica-${Date.now()}@techorg.io`;
  const invite = await onA(
    'POST',
    '/api/team/invites',
    { email, name: 'Replica Check', role: 'Developer', products: ['renewberry'] },
    owner,
  );
  const token = new URL(String(invite.json.inviteLink ?? '/'), 'http://x').searchParams.get(
    'token',
  );
  const preview = await onB('GET', `/api/auth/invite?token=${encodeURIComponent(token ?? '')}`);
  const teamB = await onB('GET', '/api/team', undefined, owner);
  const listed = (teamB.json as unknown as { email: string }[]).some?.((m) => m.email === email);
  expect(
    'members: a member invited on replica A is listed, and its invite resolves, on replica B',
    invite.status === 200 && preview.status === 200 && preview.json.email === email && !!listed,
    [invite.json, preview.json],
  );
  const dup = await onB(
    'POST',
    '/api/team/invites',
    { email, role: 'Developer', products: ['renewberry'] },
    owner,
  );
  expect(
    'members: replica B refuses the same email (unique index, 409)',
    dup.status === 409,
    dup.json,
  );
  const newId = String(invite.json.id);
  const patch = await onB('PATCH', `/api/team/${newId}`, { role: 'Tester' }, owner);
  const teamA = await onA('GET', '/api/team', undefined, owner);
  const role = (teamA.json as unknown as { id: string; role: string }[]).find?.(
    (m) => m.id === newId,
  )?.role;
  expect(
    'members: a role change on replica B is what replica A serves',
    patch.status === 200 && role === 'Tester',
    [patch.json, role],
  );

  // ── tasks, task events and comments ──
  const created = await onA(
    'POST',
    '/api/tasks',
    {
      projectId: 'p1',
      title: 'Replica proof task',
      type: 'task',
      priority: 'low',
      assignee: 'm4',
      due: '2026-12-01',
      estimate: 1,
    },
    pmA,
  );
  const key = String(created.json.key);
  const readB = await onB('GET', `/api/tasks/${key}`, undefined, pmA);
  expect(
    'tasks: a task created on replica A is served by replica B',
    created.status === 201 && readB.status === 200 && readB.json.title === 'Replica proof task',
    [created.json, readB.json],
  );
  const patchB = await onB('PATCH', `/api/tasks/${key}`, { status: 'in-progress' }, pmA);
  const comment = await onB('POST', `/api/tasks/${key}/comments`, { text: 'from B' }, pmA);
  const readA = await onA('GET', `/api/tasks/${key}`, undefined, pmA);
  expect(
    'tasks: a patch and a comment on replica B show on replica A',
    patchB.status === 200 &&
      comment.status === 201 &&
      readA.json.status === 'in-progress' &&
      readA.json.comments === 1,
    readA.json,
  );
  const activity = await onA('GET', '/api/tasks/_activity', undefined, pmA);
  const events = (activity.json.events as { taskKey: string; kind: string }[]).filter(
    (e) => e.taskKey === key,
  );
  const comments = (activity.json.comments as { taskKey: string; text: string }[]).filter(
    (c) => c.taskKey === key,
  );
  expect(
    'task events and comments: replica A returns the events and comment written on both replicas',
    ['created', 'status', 'comment'].every((k) => events.some((e) => e.kind === k)) &&
      comments.length === 1 &&
      comments[0].text === 'from B',
    { events, comments },
  );
  const second = await onB(
    'POST',
    '/api/tasks',
    {
      projectId: 'p1',
      title: 'Replica proof task 2',
      type: 'task',
      priority: 'low',
      assignee: 'm4',
      due: '2026-12-02',
      estimate: 1,
    },
    pmA,
  );
  expect(
    'tasks: keys are allocated atomically across replicas (no collision)',
    second.status === 201 && second.json.key !== key,
    [key, second.json.key],
  );

  // ── notifications ──
  // Task creation on A notified the assignee (m4) through A's domain observer.
  let inbox = await onB('GET', '/api/notifications?unread=1', undefined, devA);
  for (let i = 0; i < 20 && !JSON.stringify(inbox.json).includes(key); i++) {
    await new Promise((r) => setTimeout(r, 100));
    inbox = await onB('GET', '/api/notifications?unread=1', undefined, devA);
  }
  const items = (inbox.json.items ?? []) as { id: string; refId: string }[];
  const mine = items.find((n) => n.refId === `task:${key}:assignee:m4`);
  expect(
    'notifications: created on replica A, listed by replica B',
    inbox.status === 200 && !!mine,
    inbox.json,
  );
  const read = await onB('POST', '/api/notifications/read', { ids: [mine?.id] }, devA);
  const unreadA = await onA('GET', '/api/notifications?unread=1', undefined, devA);
  expect(
    'notifications: marked read on replica B, read on replica A',
    read.status === 200 &&
      read.json.updated === 1 &&
      !((unreadA.json.items ?? []) as { id: string }[]).some((n) => n.id === mine?.id),
    [read.json, unreadA.json],
  );
} finally {
  a.child.kill('SIGTERM');
  b.child.kill('SIGTERM');
}

console.log(failed ? '\nsmoke-replicas FAILED' : '\nsmoke-replicas passed');
process.exit(failed ? 1 : 0);
