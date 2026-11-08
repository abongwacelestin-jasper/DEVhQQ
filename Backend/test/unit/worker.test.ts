import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registeredCollections } from '../../store/collection.ts';
import {
  defaultRunners,
  planWorker,
  preflight,
  runOnce,
  type PreflightInput,
  type TaskRunners,
  type WorkerPlan,
} from '../../worker.ts';

const BACKEND = join(import.meta.dirname, '..', '..');
const ok: PreflightInput = {
  isProd: true,
  hasDatabase: true,
  hasObjectStore: true,
  loopEnabled: false,
};

/** Runs worker.ts in a fresh process with its own audit log and backup dir. */
function runWorker(args: string[]) {
  const dir = mkdtempSync(join(process.env.DEVHQ_TEST_DIR ?? '.', 'worker-'));
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'worker.ts', ...args],
    {
      cwd: BACKEND,
      env: {
        ...process.env,
        LOG_LEVEL: 'info',
        AUDIT_LOG_FILE: join(dir, 'audit.jsonl'),
        BACKUP_DIR: join(dir, 'backups'),
      },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, dir };
}

describe('worker: planWorker', () => {
  it('--once takes a de-duplicated list of one-shot tasks', () => {
    assert.deepEqual(planWorker(['--once', 'backup,drill,backup'], {}), {
      mode: 'once',
      tasks: ['backup', 'drill'],
    });
  });

  it('rejects unknown or empty task lists and unknown flags', () => {
    assert.equal(planWorker(['--once', 'monitors'], {}).mode, 'error');
    assert.equal(planWorker(['--once', ''], {}).mode, 'error');
    assert.equal(planWorker(['--loop'], {}).mode, 'error');
  });

  it('without --once runs WORKER_JOBS (default: every job)', () => {
    const all = planWorker([], {});
    assert.equal(all.mode, 'loop');
    if (all.mode === 'loop') assert.deepEqual(all.jobs.sort(), ['backup', 'digest', 'monitors']);
    assert.deepEqual(planWorker([], { WORKER_JOBS: 'monitors' }), {
      mode: 'loop',
      jobs: ['monitors'],
    });
    assert.equal(planWorker([], { WORKER_JOBS: 'none' }).mode, 'error');
    assert.equal(planWorker([], { WORKER_JOBS: 'cron' }).mode, 'error');
  });
});

describe('worker: preflight', () => {
  it('a production one-shot backup with a database and S3 may run', () => {
    assert.deepEqual(preflight({ mode: 'once', tasks: ['backup', 'drill'] }, ok), []);
  });

  it('production needs a database and durable object storage', () => {
    const plan: WorkerPlan = { mode: 'once', tasks: ['backup'] };
    assert.match(preflight(plan, { ...ok, hasDatabase: false }).join(), /DATABASE_URL/);
    assert.match(preflight(plan, { ...ok, hasObjectStore: false }).join(), /S3_ENDPOINT/);
  });

  it('fences the long-running mode in production until it is explicitly enabled', () => {
    const plan: WorkerPlan = { mode: 'loop', jobs: ['monitors'] };
    assert.match(preflight(plan, ok).join(), /fenced/);
    assert.deepEqual(preflight(plan, { ...ok, loopEnabled: true }), []);
    assert.deepEqual(preflight(plan, { ...ok, isProd: false }), []);
  });
});

describe('worker: runOnce', () => {
  it('runs tasks in order and keeps going after a failure', async () => {
    const order: string[] = [];
    const runners: TaskRunners = {
      backup: async () => {
        order.push('backup');
        throw new Error('storage down');
      },
      drill: async () => {
        order.push('drill');
        return { id: 'bk-x' };
      },
    };
    const results = await runOnce(['backup', 'drill'], runners);
    assert.deepEqual(order, ['backup', 'drill']);
    assert.deepEqual(
      results.map((r) => [r.task, r.ok]),
      [
        ['backup', false],
        ['drill', true],
      ],
    );
    assert.equal(results[0].detail.err, 'storage down');
  });

  it('the real backup and drill runners produce a verifiable backup', async () => {
    const results = await runOnce(['backup', 'drill'], defaultRunners);
    assert.ok(
      results.every((r) => r.ok),
      JSON.stringify(results),
    );
    assert.equal(results[0].detail.id, results[1].detail.id);
    assert.deepEqual(results[0].detail.uncovered, []);
  });

  it('loads every module that registers a persisted collection', async () => {
    const names = registeredCollections();
    for (const expected of ['files', 'jitGrants'])
      assert.ok(names.includes(expected), `${expected} missing from ${names.join(', ')}`);
    // Sessions and members are relational tables now (ADR 0011); backups reach them
    // through the data layer under the same names.
    const { relationalTables } = await import('../../data/index.ts');
    const tables = relationalTables().map((t) => t.name);
    for (const expected of ['sessions', 'members'])
      assert.ok(tables.includes(expected), `${expected} missing from ${tables.join(', ')}`);
  });
});

describe('worker: entry point (fresh processes)', () => {
  it('--once backup,drill exits 0 and audits both tasks, twice in a row', () => {
    for (let run = 0; run < 2; run++) {
      const res = runWorker(['--once', 'backup,drill']);
      assert.equal(res.status, 0, res.stderr + res.stdout);
      assert.match(res.stdout, /"msg":"worker.task_ok","task":"backup"/);
      assert.match(res.stdout, /"msg":"worker.finished","ok":true/);
      const auditLog = readFileSync(join(res.dir, 'audit.jsonl'), 'utf8');
      assert.match(auditLog, /backup\.created/);
      assert.match(auditLog, /backup\.drill_passed/);
    }
  });

  it('bad arguments exit 2', () => {
    const res = runWorker(['--once', 'everything']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /--once takes a list of backup, drill/);
  });
});
