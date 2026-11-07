/**
 * Shared token buckets in Redis: the same arithmetic as `refillAndTake`, run
 * atomically server side with one `EVALSHA` per take (falls back to `EVAL`
 * after a script-cache flush). Time comes from Redis (`TIME`), not from the
 * replica, so clock skew between replicas cannot mint tokens. Every bucket
 * key expires once it would have refilled completely (plus a minute), at
 * which point it is indistinguishable from a new bucket, so expiry never
 * changes a decision.
 *
 * When Redis cannot answer (disconnected, or slower than `timeoutMs`):
 *
 *  - Fail OPEN with a local bucket for limiters in `failOpen` (default: `api`).
 *    The general API limiter is abuse damping, not an authentication
 *    control; failing closed would turn a Redis outage into a full API
 *    outage. Each replica falls back to its own in-memory bucket with the
 *    same numbers, which is exactly the pre-Redis behaviour (worst case N×
 *    the budget across N replicas, for the length of the outage).
 *  - Fail CLOSED for every other limiter (`auth`, `acct`): `503
 *    rate_limit_unavailable` with `Retry-After`. Those budgets are what bound
 *    password spraying and 6-digit TOTP guessing; an outage must not
 *    multiply them by the replica count, and an attacker who can degrade
 *    Redis must not buy extra guesses. Signed-in sessions keep working
 *    (only sign-in, recovery and second-factor routes are refused).
 *
 * See docs/security/CONTROLS.md → "Rate limiting".
 */

import { createHash } from 'node:crypto';
import { HttpError } from '../types.ts';
import { logger } from '../lib/logger.ts';
import { withTimeout, type RedisClient } from '../lib/redis.ts';
import {
  MemoryRateLimitStore,
  type BucketView,
  type LimitOptions,
  type RateLimitStore,
  type TakeResult,
} from './rateLimit.ts';

/**
 * KEYS[1] bucket hash · ARGV capacity, refillPerSec, ttlMs.
 * Returns { ok (0|1), retryAfter (s), remaining }. Mirrors refillAndTake().
 */
export const TOKEN_BUCKET_LUA = `
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local b = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local tokens = tonumber(b[1])
local updated = tonumber(b[2])
if tokens == nil or updated == nil then
  tokens = capacity
  updated = now
end
local elapsed = now - updated
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + (elapsed / 1000) * refill)
local ok, retry, remaining = 0, 0, 0
if tokens < 1 then
  retry = math.ceil((1 - tokens) / refill)
else
  tokens = tokens - 1
  ok = 1
  remaining = math.floor(tokens)
end
redis.call('HSET', KEYS[1], 'tokens', string.format('%.17g', tokens), 'updated', now)
redis.call('PEXPIRE', KEYS[1], ttl)
return { ok, retry, remaining }
`;

const SCRIPT_SHA = createHash('sha1').update(TOKEN_BUCKET_LUA).digest('hex');

/** Key lifetime: time to refill from empty to full, plus a minute. */
export function bucketTtlMs(opts: LimitOptions): number {
  return Math.ceil((opts.capacity / opts.refillPerSec) * 1000) + 60_000;
}

export interface RedisRateLimitOptions {
  /** Key namespace, e.g. `devhq:`. Buckets live under `<prefix>rl:`. */
  prefix: string;
  /** Limiter names that fall back to a local bucket instead of refusing. */
  failOpen?: Iterable<string>;
  /** A take slower than this counts as Redis being down. */
  timeoutMs?: number;
}

export class RedisRateLimitStore implements RateLimitStore {
  readonly name = 'redis';
  private readonly client: RedisClient;
  private readonly prefix: string;
  private readonly failOpen: Set<string>;
  private readonly timeoutMs: number;
  /** Local buckets used only while Redis is unavailable (fail-open limiters). */
  readonly fallback = new MemoryRateLimitStore();
  private degradedSince = 0;
  /** Takes answered without Redis since boot, by outcome (console / tests). */
  readonly degraded = { failedOpen: 0, failedClosed: 0 };

  constructor(client: RedisClient, opts: RedisRateLimitOptions) {
    this.client = client;
    this.prefix = `${opts.prefix}rl:`;
    this.failOpen = new Set(opts.failOpen ?? ['api']);
    this.timeoutMs = opts.timeoutMs ?? 500;
  }

  private async evalBucket(key: string, opts: LimitOptions): Promise<unknown> {
    const args = {
      keys: [this.prefix + key],
      arguments: [String(opts.capacity), String(opts.refillPerSec), String(bucketTtlMs(opts))],
    };
    try {
      return await this.client.evalSha(SCRIPT_SHA, args);
    } catch (e) {
      if (!String((e as Error).message ?? e).includes('NOSCRIPT')) throw e;
      return this.client.eval(TOKEN_BUCKET_LUA, args);
    }
  }

  async take(key: string, opts: LimitOptions): Promise<TakeResult> {
    try {
      if (!this.client.isReady) throw new Error('not connected');
      const reply = await withTimeout(this.evalBucket(key, opts), this.timeoutMs, 'rate limit');
      if (!Array.isArray(reply) || reply.length !== 3) throw new Error('unexpected reply');
      const [ok, retryAfter, remaining] = reply.map(Number);
      if (this.degradedSince) {
        logger.info('ratelimit.redis_recovered', {
          degradedMs: Date.now() - this.degradedSince,
        });
        this.degradedSince = 0;
      }
      return { ok: ok === 1, retryAfter, remaining };
    } catch (e) {
      return this.onUnavailable(key, opts, e);
    }
  }

  private onUnavailable(key: string, opts: LimitOptions, e: unknown): TakeResult {
    if (!this.degradedSince) {
      this.degradedSince = Date.now();
      logger.error('ratelimit.redis_unavailable', {
        err: String((e as Error)?.message ?? e),
        failOpen: [...this.failOpen],
      });
    }
    if (this.failOpen.has(opts.name)) {
      this.degraded.failedOpen++;
      return this.fallback.take(key, opts);
    }
    this.degraded.failedClosed++;
    throw new HttpError(
      503,
      'rate_limit_unavailable',
      'Sign-in checks are temporarily unavailable — retry shortly',
      { retryAfter: 5 },
    );
  }

  /** Remote buckets are not enumerated (SCAN per console load is not worth it); shows fallback buckets. */
  snapshot(limit: number): BucketView[] {
    return this.fallback.snapshot(limit);
  }
}
