/**
 * Boot wiring for Redis (called by server.ts `buildApp` and worker.ts).
 *
 * Without REDIS_URL nothing changes: memory rate-limit store, in-process
 * bus, in-process job leases. With it, before the server listens:
 *
 *  - rate limits → `RedisRateLimitStore` (auth/acct fail closed, api fails
 *    open to a local bucket; security/rateLimitRedis.ts),
 *  - event bus and realtime hub → Redis pub/sub fan-out (lib/redisBus.ts),
 *  - periodic-job leases → `RedisJobLock` (lib/scheduler.ts).
 *
 * Sessions are not switched here: auth/sessionStore.ts has the interface and
 * the Redis implementation, and the data layer chooses the session backend
 * (see that file).
 */

import { logger } from './logger.ts';
import {
  closeRedis,
  connectRedis,
  redis,
  redisCommandTimeoutMs,
  redisPrefix,
  redisSubscriber,
} from './redis.ts';
import { installRedisBus, uninstallRedisBus } from './redisBus.ts';
import { MemoryJobLock, RedisJobLock, setJobLock } from './scheduler.ts';
import { MemoryRateLimitStore, setRateLimitStore } from '../security/rateLimit.ts';
import { RedisRateLimitStore } from '../security/rateLimitRedis.ts';

let installed: Promise<boolean> | undefined;

/** Idempotent. Resolves true when Redis-backed implementations were installed. */
export function installRedis(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  installed ??= (async () => {
    if (!(await connectRedis(env))) return false;
    const commands = redis()!;
    const subscriber = redisSubscriber()!;
    const prefix = redisPrefix();
    const timeoutMs = redisCommandTimeoutMs();
    setRateLimitStore(new RedisRateLimitStore(commands, { prefix, failOpen: ['api'], timeoutMs }));
    setJobLock(new RedisJobLock(commands, prefix, undefined, timeoutMs));
    await installRedisBus(commands, subscriber, prefix);
    logger.info('redis.installed', { rateLimits: 'redis', bus: 'redis', jobLocks: 'redis' });
    return true;
  })();
  return installed;
}

/** Restores the in-process implementations and closes the connections (shutdown, tests). */
export async function shutdownRedis(): Promise<void> {
  if (!installed) return;
  const was = await installed.catch(() => false);
  installed = undefined;
  if (was) {
    uninstallRedisBus();
    setRateLimitStore(new MemoryRateLimitStore());
    setJobLock(new MemoryJobLock());
  }
  await closeRedis();
}
