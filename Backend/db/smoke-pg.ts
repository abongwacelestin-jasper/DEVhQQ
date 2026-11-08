/**
 * PostgreSQL persistence smoke test (`npm run smoke:pg`).
 *
 * Requires DATABASE_URL. Runs two *fresh processes* against the same database:
 *
 *   write  — boots (migrate → hydrate → seed-if-empty), signs in with password
 *            + MFA, creates a task, comments on it, mutates it in place twice
 *            (ordering), completes a subtask, requests a JIT grant, then flushes
 *            like a graceful shutdown and exits.
 *   verify — boots again and asserts the task, comment, in-place mutations,
 *            subtask, sign-in history and JIT grant survived, that the *same
 *            bearer token* still validates (session persisted), that no raw
 *            token or raw session id is stored, and that boot did not re-seed.
 *   then     db/smoke-replicas.ts: backfill from the JSONB copy (idempotent,
 *            counts verified) and two API replicas on one database, writing
 *            through one and reading through the other for every migrated
 *            collection (ADR 0011).
 */

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const phase = process.argv[2];
const self = fileURLToPath(import.meta.url);

if (!process.env.DATABASE_URL) {
  console.error('smoke:pg needs DATABASE_URL (e.g. postgres://postgres:…@127.0.0.1:5433/devhq)');
  process.exit(2);
}

interface Handoff {
  token: string;
  key: string;
  commentId: string;
  subtaskId: string;
  grantId: string;
  signInsBefore: number;
}

// ---------------------------------------------------------------------------
// Orchestrator: run each phase in its own process (a real restart).
// ---------------------------------------------------------------------------
if (!phase) {
  const run = (args: string[]) => {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', self, ...args], {
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    // Human-readable lines only; JSON log lines go to stderr on failure for debugging.
    const lines = r.stdout.split('\n');
    for (const l of lines) if (l.startsWith('✓') || l.startsWith('✗')) console.log(l);
    if (r.status !== 0) {
      console.error(r.stderr.split('\n').slice(-30).join('\n'));
      console.error(`phase ${args[0]} failed (exit ${r.status})`);
      process.exit(1);
    }
    const result = lines.find((l) => l.startsWith('RESULT '));
    return result ? result.slice('RESULT '.length) : '';
  };
  console.log('— phase 1: write (fresh process)');
  const handoff = run(['write']);
  console.log('— phase 2: restart + verify (fresh process)');
  run(['verify', handoff]);
  console.log('— phase 3: backfill + two replicas on one database (fresh processes)');
  const replicas = spawnSync(
    process.execPath,
    ['--experimental-strip-types', self.replace(/smoke-pg\.ts$/, 'smoke-replicas.ts')],
    { env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  for (const l of replicas.stdout.split('\n'))
    if (l.startsWith('✓') || l.startsWith('✗') || l.startsWith('  ')) console.log(l);
  if (replicas.status !== 0) {
    console.error(replicas.stderr.split('\n').slice(-30).join('\n'));
    console.error(`phase 3 failed (exit ${replicas.status})`);
    process.exit(1);
  }
  console.log('\nsmoke:pg passed');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Child phases.
// ---------------------------------------------------------------------------
process.env.AUDIT_LOG_FILE = `/tmp/devhq-smoke-pg-${Date.now()}-${process.pid}.jsonl`;
const { buildApp } = await import('../server.ts');
const { flushPending } = await import('../store/collection.ts');
const { closePersistence } = await import('./boot.ts');
const { db } = await import('../store/db.ts');

const router = await buildApp();
const server = createServer((req, res) => void router.handle(req, res));
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-DevHQ-Client': 'cli', // the only client that gets a body token
      'User-Agent': 'devhq-smoke-pg',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function finish(code: number) {
  server.close();
  await closePersistence().catch((e: unknown) => console.error(String(e)));
  process.exit(code);
}

async function expect(name: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    console.log(`✗ ${name}`);
    console.error(`✗ ${name}`, JSON.stringify(detail ?? ''));
    await finish(1);
  }
  console.log(`✓ ${name}`);
}

if (phase === 'write') {
  const pw = await call('POST', '/api/auth/sign-in', {
    email: 'kofi@techorg.io',
    password: 'devhq-demo',
  });
  await expect('password step accepted', pw.status === 200, pw.json);
  const mfa = await call('POST', '/api/auth/mfa/totp', { code: '246810' }, pw.json.token as string);
  await expect('MFA accepted', mfa.status === 200, mfa.json);
  const token = mfa.json.token as string;

  const created = await call(
    'POST',
    '/api/tasks',
    {
      projectId: 'p1',
      title: 'Persisted smoke task',
      type: 'task',
      priority: 'low',
      assignee: 'm4',
      due: '2026-12-01',
      estimate: 1,
    },
    token,
  );
  await expect('task created', created.status === 201, created.json);
  const key = created.json.key as string;

  const comment = await call(
    'POST',
    `/api/tasks/${key}/comments`,
    { text: 'survives restart' },
    token,
  );
  await expect('comment created', comment.status === 201, comment.json);

  // Two quick in-place mutations: the later one must be what survives.
  const p1 = await call('PATCH', `/api/tasks/${key}`, { status: 'in-progress' }, token);
  const p2 = await call(
    'PATCH',
    `/api/tasks/${key}`,
    { status: 'review', priority: 'high' },
    token,
  );
  await expect('task patched twice', p1.status === 200 && p2.status === 200, [p1.json, p2.json]);

  const sub = await call(
    'POST',
    `/api/tasks/${key}/subtasks`,
    { title: 'persisted subtask' },
    token,
  );
  const done = await call(
    'PATCH',
    `/api/tasks/${key}/subtasks/${sub.json.id}`,
    { done: true },
    token,
  );
  await expect('subtask completed', done.status === 200 && done.json.done === true, done.json);

  const grant = await call(
    'POST',
    '/api/access/grants',
    { scope: 'production:renewberry', reason: 'smoke:pg persistence check', durationMinutes: 30 },
    token,
  );
  await expect('JIT grant requested', grant.status === 200 || grant.status === 201, grant.json);

  await flushPending(10_000);
  await expect('write queue drained', true);
  const handoff: Handoff = {
    token,
    key,
    commentId: comment.json.id as string,
    subtaskId: sub.json.id as string,
    grantId: grant.json.id as string,
    signInsBefore: db.signIns.length,
  };
  console.log(`RESULT ${JSON.stringify(handoff)}`);
  await finish(0);
}

if (phase === 'verify') {
  const h = JSON.parse(process.argv[3] ?? '{}') as Handoff;
  const { default: pg } = await import('pg');
  const raw = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await raw.connect();

  const task = await call('GET', `/api/tasks/${h.key}`, undefined, h.token);
  await expect('same bearer token still validates after restart', task.status === 200, task.json);
  await expect(
    'task survived with its last in-place mutation',
    task.json.status === 'review' && task.json.priority === 'high',
    task.json,
  );
  const { repos } = await import('../data/index.ts');
  await expect(
    'comment survived (task_comments table)',
    !!(await repos.taskComments.get(h.commentId)) && task.json.comments === 1,
  );
  await expect('subtask completion survived', db.subtasks.get(h.subtaskId)?.done === true);
  await expect(
    'sign-in history survived (bounded window rebuilt newest-first)',
    db.signIns.length >= h.signInsBefore &&
      db.signIns.length > 0 &&
      db.signIns.every((s, i, a) => i === 0 || a[i - 1].at >= s.at),
    { before: h.signInsBefore, after: db.signIns.length },
  );

  const sessions = await call('GET', '/api/auth/session', undefined, h.token);
  await expect(
    'session listing works for restored session',
    sessions.status === 200,
    sessions.json,
  );

  const rawId = h.token.slice(0, h.token.lastIndexOf('.'));
  const leaks = await raw.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM documents WHERE collection = 'sessions' AND (key = $1 OR data::text LIKE '%' || $1 || '%' OR data::text LIKE '%' || $2 || '%')",
    [rawId, h.token],
  );
  await expect('no raw token or raw session id stored', leaks.rows[0].n === '0', leaks.rows[0]);
  const tableLeaks = await raw.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM sessions WHERE id = $1 OR row_to_json(sessions)::text LIKE '%' || $1 || '%' OR row_to_json(sessions)::text LIKE '%' || $2 || '%'",
    [rawId, h.token],
  );
  const live = await raw.query<{ n: string }>('SELECT count(*)::text AS n FROM sessions');
  await expect(
    'sessions table holds the live session, never the raw token or id',
    tableLeaks.rows[0].n === '0' && Number(live.rows[0].n) > 0,
    [tableLeaks.rows[0], live.rows[0]],
  );
  const tableTask = await raw.query<{ status: string; mirrored: string }>(
    `SELECT t.status, d.data->>'status' AS mirrored FROM tasks t
     JOIN documents d ON d.collection = 'tasks' AND d.key = t.key WHERE t.key = $1`,
    [h.key],
  );
  await expect(
    'task row lives in the tasks table, and the JSONB copy is kept in step (dual-write)',
    tableTask.rows[0]?.status === 'review' && tableTask.rows[0]?.mirrored === 'review',
    tableTask.rows,
  );
  const totp = await raw.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM members WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE 'enc:%'",
  );
  await expect(
    'member TOTP secrets are sealed at rest in the members table',
    totp.rows[0].n === '0',
  );

  const grant = await raw.query<{ status: string }>(
    "SELECT data->>'status' AS status FROM documents WHERE collection = 'jitGrants' AND key = $1",
    [h.grantId],
  );
  await expect('JIT grant persisted', grant.rows[0]?.status === 'pending', grant.rows);

  const seeds = await raw.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM documents WHERE collection = 'tasks' AND key = 'RB-212'",
  );
  await expect('seed rows not duplicated', seeds.rows[0].n === '1', seeds.rows[0]);
  const migrations = await raw.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM schema_migrations',
  );
  await expect('migrations recorded once', Number(migrations.rows[0].n) >= 2, migrations.rows[0]);
  const audited = await raw.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_entries WHERE action = 'task.updated' AND target LIKE $1 || ':%'",
    [h.key],
  );
  await expect(
    'audit entries mirrored to audit_entries',
    audited.rows[0].n === '2',
    audited.rows[0],
  );
  const tamper = await raw
    .query("UPDATE audit_entries SET actor = 'mallory' WHERE target LIKE $1 || ':%'", [h.key])
    .then(
      () => 'allowed',
      () => 'rejected',
    );
  await expect('audit_entries rejects UPDATE (append-only)', tamper === 'rejected');

  // This boot continued the previous boot's audit chain (ADR 0008 addendum).
  const { audit } = await import('../audit/auditLog.ts');
  const { verifySource } = await import('../audit/chain.ts');
  const { pgAuditSource } = await import('./auditSink.ts');
  const chain = audit.status();
  await expect(
    'audit chain resumed from audit_entries after the restart',
    chain.source === 'postgres' && chain.status === 'resumed' && (chain.storedEntries ?? 0) > 0,
    chain,
  );
  const stored = await verifySource(pgAuditSource(raw));
  await expect(
    'audit_entries verifies end to end across both boots',
    stored.ok && stored.resumedBoots >= 1,
    stored,
  );

  await raw.end();
  await finish(0);
}

console.error(`unknown phase ${phase}`);
process.exit(2);
