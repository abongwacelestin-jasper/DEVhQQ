/**
 * Which periodic jobs this process runs.
 *
 * A job must run in exactly one process, or it runs twice (two backups, two
 * digest emails, two monitor checks raising two incidents). The API server
 * and `worker.ts` both ask `jobEnabled(name)` before starting a job loop.
 *
 *   JOBS_IN_PROCESS   unset | `1` | `all`   every job (the default: one process does everything)
 *                     `0` | `none`          no job (a worker or cron service runs them)
 *                     `monitors,digest`     only the jobs listed
 *
 * Unknown names refuse to boot: a typo must not silently turn a job off.
 *
 * Not covered here, on purpose:
 *  - the audit archive (storage/auditArchive.ts) ships *this process's* audit
 *    chain, so every process that writes audit entries installs it;
 *  - in-memory housekeeping (rate-limit eviction, expired enrollments) and
 *    module-level sweeps of data the API owns (sessions, JIT grants, tokens),
 *    which stay with the API until the data layer has cross-instance
 *    invalidation (docs/operations/known-limits.md).
 */

export const JOB_NAMES = ['backup', 'monitors', 'digest'] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function parseJobList(raw: string | undefined, variable = 'JOBS_IN_PROCESS'): Set<JobName> {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === '1' || v === 'all' || v === 'true') return new Set(JOB_NAMES);
  if (v === '0' || v === 'none' || v === 'false') return new Set();
  const names = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = names.filter((n) => !(JOB_NAMES as readonly string[]).includes(n));
  if (unknown.length)
    throw new Error(
      `${variable} has unknown job(s) ${unknown.join(', ')}; expected 1 | 0 | a list of ${JOB_NAMES.join(', ')}`,
    );
  return new Set(names as JobName[]);
}

let override: Set<JobName> | undefined;
let fromEnv: Set<JobName> | undefined;

/** The jobs this process runs. Parsed once from JOBS_IN_PROCESS unless overridden. */
export function enabledJobs(): Set<JobName> {
  if (override) return override;
  fromEnv ??= parseJobList(process.env.JOBS_IN_PROCESS);
  return fromEnv;
}

export function jobEnabled(name: JobName): boolean {
  return enabledJobs().has(name);
}

/** Used by worker.ts (its own list comes from WORKER_JOBS) and by tests. `undefined` resets. */
export function setEnabledJobs(jobs: Iterable<JobName> | undefined) {
  override = jobs ? new Set(jobs) : undefined;
  fromEnv = undefined;
}
