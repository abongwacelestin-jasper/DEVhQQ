/**
 * Token-bucket rate limiting, keyed by IP and (when known) by session.
 *
 * Automated, AI-driven attacks are cheap to scale; per-identity limits make
 * credential stuffing and API scraping expensive. Auth endpoints get a much
 * tighter bucket than the rest of the API.
 *
 * This in-memory store is per-process. Behind a load balancer, back it with
 * a shared store (e.g. Redis) using the same interface.
 */

import type { Middleware } from '../lib/http.ts';
import { config } from '../config/env.ts';
import { HttpError } from '../types.ts';

interface Bucket {
  tokens: number;
  updated: number;
}

export interface LimitOptions {
  /** Bucket size — the burst allowance. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
  /** Prefix so different limiters don't share buckets. */
  name: string;
}

const buckets = new Map<string, Bucket>();

function take(
  key: string,
  opts: LimitOptions,
): { ok: boolean; retryAfter: number; remaining: number } {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: opts.capacity, updated: now };
  b.tokens = Math.min(opts.capacity, b.tokens + ((now - b.updated) / 1000) * opts.refillPerSec);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / opts.refillPerSec), remaining: 0 };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true, retryAfter: 0, remaining: Math.floor(b.tokens) };
}

export function rateLimit(opts: LimitOptions): Middleware {
  return (ctx, next) => {
    const keys = [`${opts.name}:ip:${ctx.ip}`];
    if (ctx.principal) keys.push(`${opts.name}:sess:${ctx.principal.sessionId}`);
    for (const key of keys) {
      const r = take(key, opts);
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
export const apiLimiter = rateLimit({ name: 'api', ...config.rateLimits.api });
/** Tight limit for sign-in, MFA and password reset. */
export const authLimiter = rateLimit({ name: 'auth', ...config.rateLimits.auth });

/** Snapshot of the busiest buckets, for the console. */
export function limiterStats() {
  return [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      tokens: Math.floor(b.tokens),
      updated: new Date(b.updated).toISOString(),
    }))
    .sort((a, b) => a.tokens - b.tokens)
    .slice(0, 50);
}

// Evict idle buckets so memory stays bounded.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, b] of buckets) if (b.updated < cutoff) buckets.delete(k);
}, 60_000).unref();
