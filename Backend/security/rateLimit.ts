/**
 * Token-bucket rate limiting with a pluggable store.
 *
 * Automated, AI-driven attacks are cheap to scale; per-identity limits make
 * credential stuffing and API scraping expensive. Three layers:
 *
 *  - `apiLimiter`  — every request, keyed by client IP (and session/PAT when known).
 *  - `authLimiter` — auth routes, keyed by IP **and** by the account named in
 *    the request body (`email`), so rotating IPs does not buy more guesses
 *    against one account, and one IP cannot spray many accounts.
 *  - `accountLimiter` — after authentication on second-factor routes (TOTP,
 *    step-up, passkey, enrollment), keyed by member id across all sessions
 *    and IPs. This is what bounds TOTP guessing.
 *
 * Storage: the default `MemoryRateLimitStore` is per process. Behind a load
 * balancer with more than one backend replica, install a shared store at boot
 * with `setRateLimitStore()` — anything implementing `RateLimitStore` (Redis
 * `EVAL` of the same token-bucket math, a Postgres row with `FOR UPDATE`, …).
 * See docs/security/CONTROLS.md → "Rate limiting".
 */

import { createHash } from 'node:crypto';
import type { Ctx, Middleware } from '../lib/http.ts';
import { config } from '../config/env.ts';
import { HttpError } from '../types.ts';

export interface LimitOptions {
  /** Bucket size — the burst allowance. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
  /** Prefix so different limiters don't share buckets. */
  name: string;
}

export interface TakeResult {
  ok: boolean;
  /** Seconds until one token is available (0 when ok). */
  retryAfter: number;
  remaining: number;
}

export interface BucketView {
  key: string;
  tokens: number;
  updated: string;
}

/**
 * Storage contract for rate-limit buckets. `take` must be atomic per key
 * (read-refill-decrement-write in one step) for a shared store to be correct.
 */
export interface RateLimitStore {
  readonly name: string;
  take(key: string, opts: LimitOptions): TakeResult | Promise<TakeResult>;
  /** Most-drained buckets, for the console. May return [] for remote stores. */
  snapshot(limit: number): BucketView[];
}

interface Bucket {
  tokens: number;
  updated: number;
}

/** Shared token-bucket arithmetic, exported so remote stores compute identically. */
export function refillAndTake(
  b: Bucket | undefined,
  opts: LimitOptions,
  now: number,
): { bucket: Bucket; result: TakeResult } {
  const cur = b ?? { tokens: opts.capacity, updated: now };
  const tokens = Math.min(
    opts.capacity,
    cur.tokens + ((now - cur.updated) / 1000) * opts.refillPerSec,
  );
  if (tokens < 1)
    return {
      bucket: { tokens, updated: now },
      result: { ok: false, retryAfter: Math.ceil((1 - tokens) / opts.refillPerSec), remaining: 0 },
    };
  return {
    bucket: { tokens: tokens - 1, updated: now },
    result: { ok: true, retryAfter: 0, remaining: Math.floor(tokens - 1) },
  };
}

export class MemoryRateLimitStore implements RateLimitStore {
  readonly name = 'memory';
  private buckets = new Map<string, Bucket>();
  private maxKeys: number;

  constructor(maxKeys = 100_000) {
    this.maxKeys = maxKeys;
    setInterval(() => this.evictIdle(10 * 60_000), 60_000).unref();
  }

  take(key: string, opts: LimitOptions): TakeResult {
    const { bucket, result } = refillAndTake(this.buckets.get(key), opts, Date.now());
    // Bounded memory under a key-spraying attack: drop the oldest entry first.
    if (!this.buckets.has(key) && this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    this.buckets.set(key, bucket);
    return result;
  }

  snapshot(limit: number): BucketView[] {
    return [...this.buckets.entries()]
      .map(([key, b]) => ({
        key,
        tokens: Math.floor(b.tokens),
        updated: new Date(b.updated).toISOString(),
      }))
      .sort((a, b) => a.tokens - b.tokens)
      .slice(0, limit);
  }

  evictIdle(idleMs: number) {
    const cutoff = Date.now() - idleMs;
    for (const [k, b] of this.buckets) if (b.updated < cutoff) this.buckets.delete(k);
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();

/** Installs a shared store (call once at boot, before the server listens). */
export function setRateLimitStore(next: RateLimitStore) {
  store = next;
}

export function rateLimitStoreName(): string {
  return store.name;
}

/** Account identifiers are hashed so bucket keys (shown in the console) never contain emails. */
function accountKey(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('base64url').slice(0, 16);
}

function bodyEmail(ctx: Ctx): string | undefined {
  const b = ctx.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    const email = (b as Record<string, unknown>).email;
    if (typeof email === 'string' && email.length > 0 && email.length <= 254) return email;
  }
  return undefined;
}

type KeyFn = (ctx: Ctx) => string[];

/** Default keying (the original contract): client IP, plus the session/PAT when authenticated. */
const ipAndSession: KeyFn = (ctx) => [
  `ip:${ctx.ip}`,
  ...(ctx.principal ? [`sess:${ctx.principal.sessionId}`] : []),
];

export function rateLimit(opts: LimitOptions, keysOf: KeyFn = ipAndSession): Middleware {
  return async (ctx, next) => {
    for (const key of keysOf(ctx)) {
      const r = await store.take(`${opts.name}:${key}`, opts);
      ctx.res.setHeader('RateLimit-Remaining', String(r.remaining));
      if (!r.ok) {
        ctx.res.setHeader('Retry-After', String(r.retryAfter));
        throw new HttpError(429, 'rate_limited', 'Too many requests — slow down');
      }
    }
    return next();
  };
}

/** Broad limit for the whole API. */
export const apiLimiter = rateLimit({ name: 'api', ...config.rateLimits.api }, ipAndSession);

/**
 * Auth routes: per IP, plus per account when the body names one (sign-in,
 * recovery). Runs before authentication, so it cannot rely on a principal.
 */
export const authLimiter = rateLimit({ name: 'auth', ...config.rateLimits.auth }, (ctx) => {
  const email = bodyEmail(ctx);
  return [`ip:${ctx.ip}`, ...(email ? [`acct:${accountKey(email)}`] : [])];
});

/**
 * Per-member limit for second-factor and credential checks. Place it after
 * `authenticate`/`authenticatePartial`; it is keyed by member id so parallel
 * sessions or IPs share one budget.
 */
export const accountLimiter = rateLimit({ name: 'acct', ...config.accountRateLimit }, (ctx) =>
  ctx.principal ? [`member:${ctx.principal.memberId}`] : [`ip:${ctx.ip}`],
);

/** Charges the per-account bucket for a member resolved inside a handler (passkey sign-in). */
export async function chargeAccount(memberId: string) {
  const r = await store.take(`acct:member:${memberId}`, {
    name: 'acct',
    ...config.accountRateLimit,
  });
  if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many requests — slow down');
}

/** Snapshot of the busiest buckets, for the console. */
export function limiterStats() {
  return store.snapshot(50);
}
