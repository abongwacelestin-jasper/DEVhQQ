/**
 * DevHQ worker: periodic jobs outside the API process.
 *
 *   node --experimental-strip-types worker.ts --once backup,drill
 *       One-shot (the Railway cron service): boot, hydrate from Postgres, run
 *       the tasks in order, flush the audit archive and the write queue, exit.
 *       Exit 0 when every task passed, 1 when one failed, 2 on bad config.
 *
 *   node --experimental-strip-types worker.ts
 *       Long-running: the jobs in WORKER_JOBS (default: all of lib/jobs.ts)
 *       until SIGTERM. Pair it with JOBS_IN_PROCESS=0 on the API.
 *
 * Exactly once across processes: every periodic run takes a lease first
 * (lib/scheduler.ts; `SET NX PX` in Redis when REDIS_URL is set), so any mix
 * of API replicas and workers with the same job enabled runs it once per
 * slot. Without Redis the lease is per process: keep JOBS_IN_PROCESS=0 on
 * the API when a worker runs the jobs.
 *
 * Why the long-running mode is fenced in production (WORKER_LOOP_ENABLED=1):
 * every process loads all collections into memory at boot and never sees
 * another process's later writes (known-limits.md, "Run exactly one backend
 * replica"). Monitors and digests *write* (monitor state, incidents,
 * `emailedAt`), so running them here today would let the API and the worker
 * overwrite each other's rows. Redis leases stop double *runs*, not stale
 * *caches*: until the data layer serves those collections from Postgres on
 * demand (docs/operations/known-limits.md lists them), they stay in the API (JOBS_IN_PROCESS) and
 * only the read-only tasks (backup, drill) run here, one-shot, from a fresh
 * hydrate — which is also the only way to get a consistent snapshot.
 *
 * Importing server.ts registers every persisted collection (module load only:
 * its main() runs only when server.ts is the entry point), so backups made
 * here cover exactly what the API's backups cover.
 */

import { parseArgs } from 'node:util';
import { config } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { audit } from './audit/auditLog.ts';
import { closePersistence, initPersistence } from './db/boot.ts';
import { JOB_NAMES, parseJobList, setEnabledJobs, type JobName } from './lib/jobs.ts';
import { createBackup, pruneBackups, restoreDrill } from './resilience/backups.ts';
import { flushAuditArchive, installAuditArchive } from './storage/auditArchive.ts';
import { startMonitorScheduler, stopMonitorScheduler } from './monitors/scheduler.ts';
import { runDigest } from './domain/collab/notify.ts';
import { scheduleEvery } from './lib/scheduler.ts';
import { installRedis, shutdownRedis } from './lib/redisBoot.ts';
import './server.ts';

/** One-shot tasks. Read-only on collections, so safe beside a running API. */
export const ONCE_TASKS = ['backup', 'drill'] as const;
export type OnceTask = (typeof ONCE_TASKS)[number];

export type WorkerPlan =
  | { mode: 'once'; tasks: OnceTask[] }
  | { mode: 'loop'; jobs: JobName[] }
  | { mode: 'error'; message: string };

/** Parses argv (without node and script) and WORKER_JOBS into a plan. Never throws. */
export function planWorker(argv: string[], env: NodeJS.ProcessEnv = process.env): WorkerPlan {
  let once: string | undefined;
  try {
    ({
      values: { once },
    } = parseArgs({ args: argv, options: { once: { type: 'string' } }, strict: true }));
  } catch (e) {
    return { mode: 'error', message: String((e as Error).message ?? e) };
  }
  if (once !== undefined) {
    const tasks = once
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const unknown = tasks.filter((t) => !(ONCE_TASKS as readonly string[]).includes(t));
    if (!tasks.length || unknown.length)
      return {
        mode: 'error',
        message: `--once takes a list of ${ONCE_TASKS.join(', ')} (got "${once}")`,
      };
    return { mode: 'once', tasks: [...new Set(tasks)] as OnceTask[] };
  }
  try {
    const jobs = [...parseJobList(env.WORKER_JOBS, 'WORKER_JOBS')];
    if (!jobs.length) return { mode: 'error', message: 'WORKER_JOBS selects no job' };
    return { mode: 'loop', jobs };
  } catch (e) {
    return { mode: 'error', message: String((e as Error).message ?? e) };
  }
}

export interface PreflightInput {
  isProd: boolean;
  hasDatabase: boolean;
  hasObjectStore: boolean;
  loopEnabled: boolean;
}

/** Configuration problems that make a run pointless or unsafe. Empty = go. */
export function preflight(plan: WorkerPlan, f: PreflightInput): string[] {
  if (plan.mode === 'error') return [plan.message];
  const problems: string[] = [];
  if (!f.hasDatabase && f.isProd)
    problems.push('DATABASE_URL is required: without it the worker sees no data');
  if (plan.mode === 'once' && plan.tasks.includes('backup') && f.isProd && !f.hasObjectStore)
    problems.push('backup needs S3_ENDPOINT in production (local disk is not durable)');
  if (plan.mode === 'loop' && f.isProd && !f.loopEnabled)
    problems.push(
      'the long-running worker is fenced until cross-instance invalidation lands; ' +
        'keep monitors and digests in the API (JOBS_IN_PROCESS) and run `--once backup,drill` ' +
        'from cron, or set WORKER_LOOP_ENABLED=1 once the data layer supports it',
    );
  return problems;
}

export interface TaskResult {
  task: OnceTask;
  ok: boolean;
  ms: number;
  detail: Record<string, unknown>;
}

export type TaskRunners = Record<OnceTask, () => Promise<Record<string, unknown>>>;

export const defaultRunners: TaskRunners = {
  async backup() {
    const m = await createBackup('scheduled');
    const pruned = await pruneBackups();
    return { id: m.id, records: m.records, bytes: m.bytes, uncovered: m.uncovered, pruned };
  },
  async drill() {
    const r = await restoreDrill();
    if (!r.ok) throw new Error(r.id ? `drill failed on ${r.id}: ${r.error}` : 'no backup to drill');
    return { id: r.id, records: r.records, drillMs: r.ms };
  },
};

/**
 * Runs each task in order. A failed task does not stop the next one (a failed
 * backup should still let the drill check the previous one); it is logged and
 * audited, and makes the run fail.
 */
export async function runOnce(
  tasks: OnceTask[],
  runners: TaskRunners = defaultRunners,
): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  for (const task of tasks) {
    const started = Date.now();
    try {
      const detail = await runners[task]();
      results.push({ task, ok: true, ms: Date.now() - started, detail });
      logger.info('worker.task_ok', { task, ms: Date.now() - started, ...detail });
    } catch (e) {
      const err = String((e as Error)?.message ?? e);
      results.push({ task, ok: false, ms: Date.now() - started, detail: { err } });
      logger.error('worker.task_failed', { task, err });
      audit.append({
        actor: 'system',
        action: 'worker.task_failed',
        target: `${task} · ${err.slice(0, 200)}`,
        sensitive: true,
      });
    }
  }
  return results;
}

async function shutdown(code: number): Promise<never> {
  stopMonitorScheduler();
  await flushAuditArchive().catch(() => undefined);
  await closePersistence().catch((e) =>
    logger.error('worker.flush_failed', { err: String((e as Error)?.message ?? e) }),
  );
  await shutdownRedis();
  process.exit(code);
}

function startLoop(jobs: JobName[]) {
  setEnabledJobs(jobs);
  if (jobs.includes('monitors')) startMonitorScheduler();
  // Leases (lib/scheduler.ts): with REDIS_URL each run happens in exactly one
  // process, whether that is this worker, another worker or an API replica.
  if (jobs.includes('backup'))
    scheduleEvery('backup', 24 * 60 * 60_000, () => defaultRunners.backup(), { tickMs: 60_000 });
  const digestMinutes = Number(process.env.MAIL_DIGEST_MINUTES ?? 0);
  if (jobs.includes('digest') && Number.isFinite(digestMinutes) && digestMinutes > 0) {
    const ms = digestMinutes * 60_000;
    scheduleEvery('digest', ms, () => runDigest(ms));
  }
  // Every job timer is unref'd; this one keeps the process alive until SIGTERM.
  setInterval(() => logger.debug('worker.alive', { jobs }), 60 * 60_000);
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const plan = planWorker(argv);
  const problems = preflight(plan, {
    isProd: config.isProd,
    hasDatabase: !!process.env.DATABASE_URL,
    hasObjectStore: !!config.storage.endpoint,
    loopEnabled: process.env.WORKER_LOOP_ENABLED === '1',
  });
  if (problems.length || plan.mode === 'error') {
    for (const p of problems) logger.error('worker.config', { problem: p });
    process.exit(2);
  }
  // The worker never seeds: it only ever works on data the API created.
  await initPersistence(async () => {});
  // Job leases (and event fan-out) shared with the API when REDIS_URL is set.
  await installRedis();
  installAuditArchive();
  process.on('unhandledRejection', (err) =>
    logger.error('unhandledRejection', { err: String(err) }),
  );

  if (plan.mode === 'loop') {
    logger.info('worker.started', { mode: 'loop', jobs: plan.jobs, known: JOB_NAMES });
    startLoop(plan.jobs);
    return;
  }
  logger.info('worker.started', { mode: 'once', tasks: plan.tasks });
  const results = await runOnce(plan.tasks);
  const failed = results.filter((r) => !r.ok).map((r) => r.task);
  logger.info('worker.finished', { ok: !failed.length, failed });
  await shutdown(failed.length ? 1 : 0);
}

if (process.argv[1]?.endsWith('worker.ts')) {
  main().catch((err) => {
    logger.error('worker.fatal', { err: String((err as Error)?.stack ?? err) });
    process.exit(1);
  });
}
