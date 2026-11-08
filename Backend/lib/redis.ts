/**
 * Shared Redis connection (ADR 0009): what makes rate limits, the event bus,
 * realtime streams and periodic-job locks work across more than one process.
 *
 *   REDIS_URL         redis://… or rediss://… (TLS). Unset = in-process
 *                     behaviour everywhere (development, tests, one replica).
 *   REDIS_KEY_PREFIX  namespace for every key and channel (default `devhq:`),
 *                     so environments can share one Redis without colliding.
 *   REDIS_COMMAND_TIMEOUT_MS  a command slower than this counts as Redis
 *                     being down (default 500): rate limits fall back or
 *                     refuse, job leases skip the run.
 *   EXPECT_REPLICAS   how many API replicas run (default 1). In production,
 *                     more than one without REDIS_URL refuses to boot: per
 *                     process limits and buses would silently be wrong.
 *
 * Connection behaviour:
 *  - `rediss://` turns TLS on (certificate verified, SNI = the URL's host).
 *  - Reconnects forever with capped exponential backoff and jitter
 *    (50 ms → 5 s). A boot without Redis is not fatal unless Redis is
 *    required: callers fall back as documented per feature.
 *  - The offline queue is disabled: while disconnected every command fails
 *    at once instead of waiting, so a Redis outage costs a fallback, not a
 *    hung request. `withTimeout` bounds a connected-but-stalled server.
 *  - Two connections per process: commands, and a dedicated subscriber
 *    (RESP2 pub/sub takes the connection over).
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createClient } from '@redis/client';
import { logger } from './logger.ts';

export type RedisClient = ReturnType<typeof buildClient>;

/** Identifies this process in pub/sub envelopes and lock values. */
export const INSTANCE_ID = `${hostname().slice(0, 32)}:${process.pid}:${randomUUID().slice(0, 8)}`;

export interface RedisSettings {
  url?: string;
  prefix: string;
  replicas: number;
  isProd: boolean;
  commandTimeoutMs: number;
}

export function redisSettings(env: NodeJS.ProcessEnv = process.env): RedisSettings {
  const replicasRaw = (env.EXPECT_REPLICAS ?? '').trim();
  const replicas = replicasRaw === '' ? 1 : Number(replicasRaw);
  const timeoutRaw = (env.REDIS_COMMAND_TIMEOUT_MS ?? '').trim();
  return {
    url: env.REDIS_URL?.trim() || undefined,
    prefix: env.REDIS_KEY_PREFIX?.trim() || 'devhq:',
    replicas,
    isProd: env.NODE_ENV === 'production',
    commandTimeoutMs: timeoutRaw === '' ? 500 : Number(timeoutRaw),
  };
}

/** Configuration problems that must stop the boot. Empty = go. */
export function redisBootProblems(s: RedisSettings): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(s.replicas) || s.replicas < 1)
    problems.push('EXPECT_REPLICAS must be a positive integer');
  if (
    !Number.isInteger(s.commandTimeoutMs) ||
    s.commandTimeoutMs < 10 ||
    s.commandTimeoutMs > 30_000
  )
    problems.push('REDIS_COMMAND_TIMEOUT_MS must be an integer between 10 and 30000');
  if (s.url && !/^rediss?:\/\//i.test(s.url))
    problems.push('REDIS_URL must start with redis:// or rediss://');
  if (s.url && !/^[A-Za-z0-9:_.-]{1,64}$/.test(s.prefix))
    problems.push('REDIS_KEY_PREFIX may only use letters, digits and : _ . - (≤ 64)');
  if (s.isProd && s.replicas > 1 && !s.url)
    problems.push(
      `EXPECT_REPLICAS=${s.replicas} needs REDIS_URL: rate limits, the event bus, realtime ` +
        'streams and job locks would otherwise be per replica',
    );
  return problems;
}

/** Capped exponential backoff with full jitter: 50 ms, 100 ms, … up to 5 s. */
export function reconnectDelayMs(retries: number, random = Math.random): number {
  const cap = Math.min(5_000, 50 * 2 ** Math.min(retries, 10));
  return Math.round(cap / 2 + random() * (cap / 2));
}

/** Redacts the password for logs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'redis://(unparseable)';
  }
}

function buildClient(url: string, role: string) {
  const tls = /^rediss:\/\//i.test(url);
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  })();
  return createClient({
    url,
    name: `devhq-${role}`,
    disableOfflineQueue: true,
    // Railway's TCP proxy and most managed Redis drop idle connections.
    pingInterval: 30_000,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries: number) => reconnectDelayMs(retries),
      ...(tls ? { tls: true as const, servername: host, rejectUnauthorized: true } : {}),
    },
  });
}

export function createRedisClient(url: string, role: string): RedisClient {
  const client = buildClient(url, role);
  let down = false;
  client.on('error', (err: Error) => {
    // node-redis emits an error for every failed reconnect; log the transition only.
    if (down) return;
    down = true;
    logger.warn('redis.error', { role, err: err.message });
  });
  client.on('ready', () => {
    if (down) logger.info('redis.reconnected', { role });
    down = false;
  });
  return client;
}

/** Rejects after `ms` if the promise has not settled. */
export function withTimeout<T>(p: Promise<T>, ms: number, what = 'redis'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    timer.unref();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// ── Process-wide connection ────────────────────────────────────────────────

let settings: RedisSettings = redisSettings();
let commands: RedisClient | undefined;
let subscriber: RedisClient | undefined;

export function redisPrefix(): string {
  return settings.prefix;
}

export function redisCommandTimeoutMs(): number {
  return settings.commandTimeoutMs;
}

/** True when this process runs with REDIS_URL (whether or not it is reachable now). */
export function redisConfigured(): boolean {
  return !!commands;
}

/** True when more than one replica is expected: shared state is then mandatory. */
export function redisRequired(): boolean {
  return settings.replicas > 1;
}

/** The command connection, or undefined without REDIS_URL. Check `isReady` before relying on it. */
export function redis(): RedisClient | undefined {
  return commands;
}

/** The subscriber connection (created by `connectRedis`). */
export function redisSubscriber(): RedisClient | undefined {
  return subscriber;
}

async function connectOne(c: RedisClient, role: string, timeoutMs: number): Promise<boolean> {
  try {
    await withTimeout(c.connect(), timeoutMs, `redis ${role} connect`);
    return true;
  } catch (e) {
    // The client keeps reconnecting in the background.
    logger.warn('redis.connect_failed', { role, err: String((e as Error).message ?? e) });
    return false;
  }
}

/**
 * Validates the settings and connects both connections. Returns false when
 * Redis is not configured. Throws on a configuration problem, or when Redis
 * is required (EXPECT_REPLICAS > 1) and cannot be reached at boot.
 */
export async function connectRedis(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 5_000,
): Promise<boolean> {
  if (commands) return true;
  settings = redisSettings(env);
  const problems = redisBootProblems(settings);
  if (problems.length) throw new Error(problems.join('; '));
  if (!settings.url) return false;
  commands = createRedisClient(settings.url, 'commands');
  subscriber = createRedisClient(settings.url, 'subscriber');
  const [a, b] = await Promise.all([
    connectOne(commands, 'commands', timeoutMs),
    connectOne(subscriber, 'subscriber', timeoutMs),
  ]);
  logger.info('redis.configured', {
    url: redactUrl(settings.url),
    prefix: settings.prefix,
    replicas: settings.replicas,
    connected: a && b,
    instance: INSTANCE_ID,
  });
  if (!(a && b) && redisRequired()) {
    await closeRedis();
    throw new Error(
      `Redis is required with EXPECT_REPLICAS=${settings.replicas} but ${redactUrl(settings.url!)} is unreachable`,
    );
  }
  return true;
}

export interface RedisHealth {
  status: 'disabled' | 'up' | 'down';
  required: boolean;
  latencyMs?: number;
  error?: string;
}

/** PING with a short timeout, for /api/ready. */
export async function redisHealth(timeoutMs = 1_000): Promise<RedisHealth> {
  const required = redisRequired();
  if (!commands) return { status: 'disabled', required };
  if (!commands.isReady || !subscriber?.isReady)
    return { status: 'down', required, error: 'not connected' };
  const started = performance.now();
  try {
    await withTimeout(commands.ping(), timeoutMs, 'redis ping');
    return { status: 'up', required, latencyMs: Math.round(performance.now() - started) };
  } catch (e) {
    return { status: 'down', required, error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

/** Closes both connections (shutdown, tests). Safe to call more than once. */
export async function closeRedis(): Promise<void> {
  const all = [commands, subscriber].filter((c): c is RedisClient => !!c);
  commands = undefined;
  subscriber = undefined;
  await Promise.all(
    all.map(async (c) => {
      try {
        if (c.isOpen) await withTimeout(c.close(), 2_000, 'redis close');
        else c.destroy();
      } catch {
        try {
          c.destroy();
        } catch {
          /* already gone */
        }
      }
    }),
  );
}
