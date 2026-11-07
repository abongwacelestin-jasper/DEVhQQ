import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  client,
  closeClient,
  dropPrefix,
  redisProxy,
  sleep,
  uniquePrefix,
  until,
} from './helpers.ts';
import { createRedisClient, type RedisClient } from '../../lib/redis.ts';
import { bucketTtlMs, RedisRateLimitStore } from '../../security/rateLimitRedis.ts';
import { refillAndTake, type LimitOptions } from '../../security/rateLimit.ts';
import { HttpError } from '../../types.ts';

let a: RedisClient;
let b: RedisClient;
const prefixes: string[] = [];

function prefix(tag: string) {
  const p = uniquePrefix(tag);
  prefixes.push(p);
  return p;
}

before(async () => {
  a = await client(undefined, 'rl-a');
  b = await client(undefined, 'rl-b');
});

after(async () => {
  for (const p of prefixes) await dropPrefix(a, p);
  await closeClient(a);
  await closeClient(b);
});

describe('RedisRateLimitStore — atomic token bucket', () => {
  it('grants exactly `capacity` of 400 concurrent takes split across two replicas', async () => {
    const p = prefix('atomic');
    // Two stores on two connections = two replicas sharing one Redis.
    const s1 = new RedisRateLimitStore(a, { prefix: p, timeoutMs: 5_000 });
    const s2 = new RedisRateLimitStore(b, { prefix: p, timeoutMs: 5_000 });
    const opts: LimitOptions = { name: 'auth', capacity: 50, refillPerSec: 0.001 };
    const results = await Promise.all(
      Array.from({ length: 400 }, (_, i) => (i % 2 ? s1 : s2).take('auth:ip:198.51.100.7', opts)),
    );
    const granted = results.filter((r) => r.ok).length;
    assert.equal(granted, 50, `exactly capacity granted, got ${granted}`);
    // Every granted take saw a distinct `remaining` (no two read the same bucket state).
    const remaining = results.filter((r) => r.ok).map((r) => r.remaining);
    assert.equal(new Set(remaining).size, 50, 'no lost update: remaining values are all distinct');
    assert.deepEqual(
      [...remaining].sort((x, y) => x - y),
      Array.from({ length: 50 }, (_, i) => i),
    );
    const denied = results.filter((r) => !r.ok);
    assert.ok(denied.every((r) => r.retryAfter >= 1 && r.remaining === 0));
    assert.equal(s1.degraded.failedOpen + s1.degraded.failedClosed, 0, 'Redis answered every take');
  });

  it('matches refillAndTake() decision for decision, including refill over time', async () => {
    const p = prefix('math');
    const store = new RedisRateLimitStore(a, { prefix: p, timeoutMs: 10_000 });
    const opts: LimitOptions = { name: 'auth', capacity: 3, refillPerSec: 0.0001 };
    let local: Parameters<typeof refillAndTake>[0];
    for (let i = 0; i < 5; i++) {
      const step = refillAndTake(local, opts, 0);
      local = step.bucket;
      assert.deepEqual(await store.take('k', opts), step.result, `take ${i + 1}`);
    }
    // Refill: 2 tokens/s, capacity 1. Empty now; one token back after 0.5 s.
    const fast: LimitOptions = { name: 'auth', capacity: 1, refillPerSec: 2 };
    assert.equal((await store.take('f', fast)).ok, true);
    const denied = await store.take('f', fast);
    if (!denied.ok) assert.equal(denied.retryAfter, 1);
    await sleep(1_100);
    assert.equal((await store.take('f', fast)).ok, true, 'refilled');
  });

  it('sets an expiry on every bucket (full refill + 60 s), so idle keys disappear', async () => {
    const p = prefix('ttl');
    const store = new RedisRateLimitStore(a, { prefix: p, timeoutMs: 10_000 });
    const opts: LimitOptions = { name: 'auth', capacity: 10, refillPerSec: 0.1 };
    await store.take('auth:ip:203.0.113.1', opts);
    const ttl = await a.pTTL(`${p}rl:auth:ip:203.0.113.1`);
    assert.ok(ttl > 0 && ttl <= bucketTtlMs(opts), `ttl ${ttl}`);
    assert.equal(bucketTtlMs(opts), 160_000);
  });

  it('reloads the script after SCRIPT FLUSH (NOSCRIPT → EVAL)', async () => {
    const p = prefix('noscript');
    const store = new RedisRateLimitStore(a, { prefix: p, timeoutMs: 5_000 });
    const opts: LimitOptions = { name: 'api', capacity: 2, refillPerSec: 0.001 };
    assert.equal((await store.take('k', opts)).ok, true);
    await a.scriptFlush();
    assert.equal((await store.take('k', opts)).ok, true);
    assert.equal((await store.take('k', opts)).ok, false);
  });
});

describe('RedisRateLimitStore — Redis down', () => {
  it('api fails open to a local bucket, auth/acct fail closed with 503, and both recover', async () => {
    const p = prefix('outage');
    const proxy = await redisProxy();
    const c = createRedisClient(proxy.url, 'rl-outage');
    await c.connect();
    try {
      const store = new RedisRateLimitStore(c, { prefix: p, failOpen: ['api'], timeoutMs: 10_000 });
      const api: LimitOptions = { name: 'api', capacity: 2, refillPerSec: 0.001 };
      const auth: LimitOptions = { name: 'auth', capacity: 5, refillPerSec: 0.001 };
      assert.equal((await store.take('api:ip:1', api)).ok, true, 'shared bucket while up');

      await proxy.cut();
      assert.ok(await until(() => !c.isReady), 'client notices the outage');

      // api: local fallback bucket with the same numbers (fresh: capacity 2).
      const local = [];
      for (let i = 0; i < 3; i++) local.push((await store.take('api:ip:1', api)).ok);
      assert.deepEqual(local, [true, true, false], 'fallback bucket still limits');
      assert.equal(store.degraded.failedOpen, 3);

      // auth and acct: refused, never waved through.
      for (const name of ['auth', 'acct']) {
        await assert.rejects(
          Promise.resolve(store.take(`${name}:ip:1`, { ...auth, name })),
          (e: unknown) =>
            e instanceof HttpError && e.status === 503 && e.code === 'rate_limit_unavailable',
        );
      }
      assert.equal(store.degraded.failedClosed, 2);

      // Recovery: the client reconnects with backoff and the shared bucket is back.
      await proxy.restore();
      assert.ok(await until(() => c.isReady), 'client reconnects');
      assert.equal((await store.take('api:ip:1', api)).ok, true, 'shared bucket after recovery');
      assert.equal(
        (await store.take('api:ip:1', api)).ok,
        false,
        'Redis kept the pre-outage state',
      );
      assert.equal((await store.take('auth:ip:1', auth)).ok, true, 'auth allowed again');
    } finally {
      await closeClient(c);
      await proxy.close();
    }
  });

  it('treats a stalled Redis (slower than timeoutMs) as down', async () => {
    const p = prefix('stall');
    const c = await client(undefined, 'rl-stall');
    const blocker = await client(undefined, 'rl-blocker');
    try {
      const store = new RedisRateLimitStore(c, { prefix: p, timeoutMs: 300 });
      // CLIENT PAUSE stalls every write command for 4 s while the socket stays up.
      await blocker.sendCommand(['CLIENT', 'PAUSE', '4000', 'WRITE']);
      const started = Date.now();
      await assert.rejects(
        Promise.resolve(store.take('auth:ip:2', { name: 'auth', capacity: 5, refillPerSec: 1 })),
        (e: unknown) => e instanceof HttpError && e.status === 503,
      );
      assert.ok(Date.now() - started < 3_000, 'answered at the timeout, not after the pause');
      assert.equal(
        (await store.take('api:ip:2', { name: 'api', capacity: 5, refillPerSec: 1 })).ok,
        true,
        'api falls back while stalled',
      );
    } finally {
      await blocker.sendCommand(['CLIENT', 'UNPAUSE']);
      await closeClient(c);
      await closeClient(blocker);
    }
  });
});
