/**
 * Periodic jobs that run exactly once across processes.
 *
 * lib/jobs.ts decides which jobs a process *may* run (JOBS_IN_PROCESS,
 * WORKER_JOBS). This module decides, for each run, *which* of those
 * processes runs it, with a lease:
 *
 *  - `scheduleEvery(name, intervalMs, fn)`: wall-clock slots of `intervalMs`
 *    (slot = floor(now / interval)). Every candidate process ticks; the
 *    first to take the lease `job:<name>:<slot>` runs the job, the others
 *    skip that slot. One run per slot, cluster-wide, whichever process wins.
 *  - `runExclusive(key, ttlMs, fn)`: one run per lease window, for work that
 *    is not slot-aligned (one monitor check per monitor per interval).
 *
 * The lease store is in-process by default (one process: the lease only
 * guards against overlapping timers). With REDIS_URL, lib/redisBoot.ts
 * installs `RedisJobLock`: `SET <prefix>lock:<key> <instance> NX PX <ttl>`,
 * atomic in Redis, so two API replicas or two workers never both win.
 *
 * Leases are never released early: a slot lease outlives its slot (2×
 * interval), so a process that ticks late, or restarts, cannot run the
 * same slot again. When the lock store cannot answer, the run is skipped
 * and retried on the next tick within the same slot: a missed run is
 * preferred to a double run (two digests, two incidents).
 */

import { logger } from './logger.ts';
import { INSTANCE_ID, withTimeout, type RedisClient } from './redis.ts';

export interface JobLock {
  readonly name: string;
  /** Takes the lease if nobody holds it. Rejects when the lock store is unreachable. */
  tryAcquire(key: string, ttlMs: number): Promise<boolean>;
}

export class MemoryJobLock implements JobLock {
  readonly name = 'memory';
  private leases = new Map<string, number>();

  async tryAcquire(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    if (this.leases.size > 10_000)
      for (const [k, until] of this.leases) if (until <= now) this.leases.delete(k);
    const until = this.leases.get(key);
    if (until !== undefined && until > now) return false;
    this.leases.set(key, now + ttlMs);
    return true;
  }
}

/** `SET key owner NX PX ttl`: atomic, so exactly one contender gets 'OK'. */
export class RedisJobLock implements JobLock {
  readonly name = 'redis';
  private readonly client: RedisClient;
  private readonly prefix: string;
  private readonly owner: string;
  private readonly timeoutMs: number;

  constructor(client: RedisClient, prefix: string, owner = INSTANCE_ID, timeoutMs = 1_000) {
    this.client = client;
    this.prefix = `${prefix}lock:`;
    this.owner = owner;
    this.timeoutMs = timeoutMs;
  }

  async tryAcquire(key: string, ttlMs: number): Promise<boolean> {
    if (!this.client.isReady) throw new Error('redis not connected');
    const r = await withTimeout(
      this.client.set(this.prefix + key, this.owner, {
        condition: 'NX',
        expiration: { type: 'PX', value: ttlMs },
      }),
      this.timeoutMs,
      'job lock',
    );
    return r === 'OK';
  }
}

let lock: JobLock = new MemoryJobLock();

export function setJobLock(next: JobLock) {
  lock = next;
}

export function jobLockName(): string {
  return lock.name;
}

export type ExclusiveResult = 'ran' | 'held' | 'lock_unavailable';

/** Runs `fn` if this process wins the lease `key` for `ttlMs`. Never throws for lock errors. */
export async function runExclusive(
  key: string,
  ttlMs: number,
  fn: () => unknown,
): Promise<ExclusiveResult> {
  let won: boolean;
  try {
    won = await lock.tryAcquire(key, Math.max(1, Math.round(ttlMs)));
  } catch (e) {
    logger.warn('job.lock_unavailable', { key, err: String((e as Error)?.message ?? e) });
    return 'lock_unavailable';
  }
  if (!won) return 'held';
  await fn();
  return 'ran';
}

export function slotOf(now: number, intervalMs: number): number {
  return Math.floor(now / intervalMs);
}

export interface ScheduleOptions {
  /** How often candidates check for a new slot (default: min(interval, 30 s)). */
  tickMs?: number;
  /**
   * Do not run in the slot that is current at start-up (default true): the
   * first run happens at the next slot boundary, so a deploy does not trigger
   * a run, and a daily job runs daily however often the service restarts.
   */
  skipCurrentSlot?: boolean;
}

/** Starts a slot-aligned job. Returns a stop function. Timers are unref'd. */
export function scheduleEvery(
  name: string,
  intervalMs: number,
  fn: (slot: number) => unknown,
  opts: ScheduleOptions = {},
): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0)
    throw new Error(`scheduleEvery(${name}): interval must be > 0`);
  const tickMs = opts.tickMs ?? Math.min(intervalMs, 30_000);
  let handled = opts.skipCurrentSlot === false ? -1 : slotOf(Date.now(), intervalMs);
  let busy = false;
  const tick = async () => {
    const slot = slotOf(Date.now(), intervalMs);
    if (slot <= handled || busy) return;
    busy = true;
    try {
      const r = await runExclusive(`job:${name}:${slot}`, intervalMs * 2, () => fn(slot));
      // A lock error leaves the slot open, so the next tick retries it.
      if (r !== 'lock_unavailable') handled = slot;
      if (r === 'ran') logger.info('job.ran', { job: name, slot, lock: lock.name });
    } catch (e) {
      // The job itself failed: the slot is spent (no retry storm), the next slot runs again.
      handled = slot;
      logger.error('job.failed', { job: name, slot, err: String((e as Error)?.message ?? e) });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), tickMs);
  timer.unref();
  if (opts.skipCurrentSlot === false) void tick();
  return () => clearInterval(timer);
}
