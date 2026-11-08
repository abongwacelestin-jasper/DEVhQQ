/**
 * Redis wiring without a Redis server: configuration rules, the no-Redis
 * fallback (today's in-process behaviour), Redis-down behaviour against a
 * port nobody listens on, and the pieces of the cross-replica transport that
 * do not need a server. The suites against a real Redis are test/redis/.
 */

import '../setup.ts';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { createServer } from 'node:net';
import {
  connectRedis,
  createRedisClient,
  reconnectDelayMs,
  redactUrl,
  redisBootProblems,
  redisHealth,
  redisSettings,
  type RedisClient,
} from '../../lib/redis.ts';
import { installRedis } from '../../lib/redisBoot.ts';
import { parseEnvelope, withResolvedProduct } from '../../lib/redisBus.ts';
import {
  deliverRemote,
  publish,
  subscribe,
  subscribeFanout,
  type BusEvent,
} from '../../lib/events.ts';
import {
  jobLockName,
  MemoryJobLock,
  RedisJobLock,
  runExclusive,
  scheduleEvery,
  setJobLock,
  slotOf,
} from '../../lib/scheduler.ts';
import {
  MemoryRateLimitStore,
  rateLimit,
  rateLimitStoreName,
  setRateLimitStore,
} from '../../security/rateLimit.ts';
import { RedisRateLimitStore } from '../../security/rateLimitRedis.ts';
import { openStream, receiveRemote, streamStats } from '../../domain/collab/realtime.ts';
import { channels } from '../../domain/collab/store.ts';
import { defaultPermissions } from '../../domain/collab/seed.ts';
import { seed } from '../../store/db.ts';
import { repos } from '../../data/index.ts';
import type { Ctx } from '../../lib/http.ts';
import { HttpError, type Principal } from '../../types.ts';
import { startApp } from '../helpers/server.ts';

/** A loopback port with nothing listening on it. */
function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

let deadUrl = '';
let dead: RedisClient;

before(async () => {
  await seed();
  deadUrl = `redis://127.0.0.1:${await closedPort()}`;
  // Never connected: what every Redis-backed piece sees during an outage.
  dead = createRedisClient(deadUrl, 'dead');
});

after(() => {
  // Never connected, so there is nothing to close.
  if (dead.isOpen) dead.destroy();
  setRateLimitStore(new MemoryRateLimitStore());
  setJobLock(new MemoryJobLock());
});

describe('lib/redis — configuration', () => {
  it('defaults: no URL, prefix devhq:, one replica, 500 ms command timeout', () => {
    const s = redisSettings({});
    assert.deepEqual(s, {
      url: undefined,
      prefix: 'devhq:',
      replicas: 1,
      isProd: false,
      commandTimeoutMs: 500,
    });
    assert.deepEqual(redisBootProblems(s), []);
  });

  it('production with more than one replica refuses to boot without REDIS_URL', () => {
    const problems = redisBootProblems(
      redisSettings({ NODE_ENV: 'production', EXPECT_REPLICAS: '2' }),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /EXPECT_REPLICAS=2 needs REDIS_URL/);
    assert.deepEqual(
      redisBootProblems(
        redisSettings({
          NODE_ENV: 'production',
          EXPECT_REPLICAS: '2',
          REDIS_URL: 'rediss://h:6380',
        }),
      ),
      [],
    );
    // One replica in production without Redis is today's supported set-up.
    assert.deepEqual(redisBootProblems(redisSettings({ NODE_ENV: 'production' })), []);
  });

  it('rejects malformed values instead of guessing', () => {
    const bad = (env: NodeJS.ProcessEnv) => redisBootProblems(redisSettings(env)).length;
    assert.equal(bad({ EXPECT_REPLICAS: '0' }), 1);
    assert.equal(bad({ EXPECT_REPLICAS: 'two' }), 1);
    assert.equal(bad({ REDIS_URL: 'http://h' }), 1);
    assert.equal(bad({ REDIS_URL: 'redis://h', REDIS_KEY_PREFIX: 'a b' }), 1);
    assert.equal(bad({ REDIS_COMMAND_TIMEOUT_MS: '5' }), 1);
  });

  it('connectRedis throws on those problems', async () => {
    await assert.rejects(
      connectRedis({ NODE_ENV: 'production', EXPECT_REPLICAS: '3' }),
      /EXPECT_REPLICAS=3 needs REDIS_URL/,
    );
  });

  it('refuses to boot when Redis is required (EXPECT_REPLICAS > 1) but unreachable', async () => {
    await assert.rejects(
      connectRedis({ REDIS_URL: deadUrl, EXPECT_REPLICAS: '2' }, 300),
      /Redis is required with EXPECT_REPLICAS=2/,
    );
    assert.equal((await redisHealth()).status, 'disabled', 'connections were closed');
  });

  it('reconnect backoff grows, is capped at 5 s, and is jittered', () => {
    assert.equal(
      reconnectDelayMs(0, () => 0),
      25,
    );
    assert.equal(
      reconnectDelayMs(0, () => 1),
      50,
    );
    assert.equal(
      reconnectDelayMs(3, () => 1),
      400,
    );
    assert.equal(
      reconnectDelayMs(50, () => 1),
      5_000,
    );
    assert.equal(
      reconnectDelayMs(50, () => 0),
      2_500,
    );
  });

  it('never logs the password', () => {
    assert.equal(redactUrl('rediss://default:s3cret@h:6380/0'), 'rediss://default:***@h:6380/0');
  });
});

describe('no REDIS_URL — in-process behaviour, unchanged', () => {
  it('installs nothing: memory rate limits, memory job leases, Redis "disabled"', async () => {
    assert.equal(await installRedis({}), false);
    assert.equal(rateLimitStoreName(), 'memory');
    assert.equal(jobLockName(), 'memory');
    assert.deepEqual(await redisHealth(), { status: 'disabled', required: false });
  });

  it('/api/ready reports redis: disabled and stays ready', async () => {
    const app = await startApp();
    try {
      const r = await app.client().get<{ ready: boolean; redis: string }>('/api/ready');
      assert.equal(r.status, 200);
      assert.equal(r.json.ready, true);
      assert.equal(r.json.redis, 'disabled');
    } finally {
      await app.close();
    }
  });

  it('publish reaches both local listeners once; remote events reach fan-out only', () => {
    const local: string[] = [];
    const fanout: string[] = [];
    const off1 = subscribe((e) => local.push(e.type));
    const off2 = subscribeFanout((e) => fanout.push(e.type));
    publish('task', { key: 'X-1', product: 'renewberry' });
    deliverRemote({ type: 'remote.only', at: new Date().toISOString(), data: {} });
    off1();
    off2();
    assert.deepEqual(local, ['task'], 'side-effect listeners never see remote events');
    assert.deepEqual(fanout, ['task', 'remote.only']);
  });

  it('memory job leases: one run per key per window, slot-aligned schedules', async (t) => {
    setJobLock(new MemoryJobLock());
    let n = 0;
    assert.equal(await runExclusive('k', 1_000, () => n++), 'ran');
    assert.equal(await runExclusive('k', 1_000, () => n++), 'held');
    assert.equal(n, 1);
    assert.equal(slotOf(86_400_000 * 3 + 5, 86_400_000), 3);

    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 10_000 });
    const slots: number[] = [];
    const stop = scheduleEvery('probe', 1_000, (slot) => slots.push(slot), { tickMs: 100 });
    for (let i = 0; i < 35; i++) {
      t.mock.timers.tick(100);
      await new Promise((r) => setImmediate(r));
    }
    stop();
    assert.deepEqual(slots, [11, 12, 13], 'skips the boot slot, then once per slot');
  });
});

describe('Redis down — documented failure modes', () => {
  it('api limiter fails open to a local bucket; auth and acct fail closed (503 + Retry-After)', async () => {
    const store = new RedisRateLimitStore(dead, { prefix: 'u:', failOpen: ['api'] });
    setRateLimitStore(store);
    try {
      const api = rateLimit({ name: 'api', capacity: 2, refillPerSec: 0.001 });
      const auth = rateLimit({ name: 'auth', capacity: 50, refillPerSec: 1 });
      const acct = rateLimit({ name: 'acct', capacity: 50, refillPerSec: 1 });
      const run = async (mw: ReturnType<typeof rateLimit>) => {
        const headers: Record<string, string> = {};
        const ctx = {
          ip: '192.0.2.10',
          res: { setHeader: (k: string, v: string) => (headers[k] = v) },
        } as unknown as Ctx;
        try {
          await mw(ctx, async () => undefined);
          return { status: 200, headers };
        } catch (e) {
          assert.ok(e instanceof HttpError);
          return { status: e.status, code: e.code, headers };
        }
      };
      assert.deepEqual(
        [(await run(api)).status, (await run(api)).status, (await run(api)).status],
        [200, 200, 429],
        'local fallback bucket still limits',
      );
      for (const mw of [auth, acct]) {
        const r = await run(mw);
        assert.equal(r.status, 503);
        assert.equal(r.code, 'rate_limit_unavailable');
        assert.equal(r.headers['Retry-After'], '5');
      }
      assert.deepEqual(store.degraded, { failedOpen: 3, failedClosed: 2 });
    } finally {
      setRateLimitStore(new MemoryRateLimitStore());
    }
  });

  it('job leases: the run is skipped, never run unguarded', async () => {
    setJobLock(new RedisJobLock(dead, 'u:'));
    try {
      let ran = 0;
      assert.equal(await runExclusive('monitor:m', 1_000, () => ran++), 'lock_unavailable');
      assert.equal(ran, 0);
    } finally {
      setJobLock(new MemoryJobLock());
    }
  });
});

describe('cross-replica transport (no server needed)', () => {
  it('drops its own echo and malformed messages; accepts other instances', () => {
    const e: BusEvent = { type: 'task', at: new Date(0).toISOString(), data: { key: 'K' } };
    const guard = (v: unknown): v is BusEvent => typeof v === 'object' && v !== null;
    assert.equal(parseEnvelope(JSON.stringify({ o: 'me', e }), guard, 'me'), undefined);
    assert.deepEqual(parseEnvelope(JSON.stringify({ o: 'other', e }), guard, 'me'), e);
    assert.equal(parseEnvelope('not json', guard, 'me'), undefined);
    assert.equal(parseEnvelope(JSON.stringify({ e }), guard, 'me'), undefined);
  });

  it('resolves the product before an event leaves its replica', async () => {
    const task = (await repos.tasks.list())[0];
    const e: BusEvent = { type: 'task', at: '', data: { key: task.key } };
    assert.equal(withResolvedProduct(e).product, task.product);
    const unknown: BusEvent = { type: 'task', at: '', data: { key: 'NOPE-1' } };
    assert.equal(withResolvedProduct(unknown).product, undefined, 'unresolvable stays unscoped');
  });

  it('a remote realtime event goes through the same per-subscriber checks', async () => {
    const people = new Map((await repos.members.list()).map((m) => [m.id, m]));
    class FakeRes extends EventEmitter {
      frames: string[] = [];
      writableEnded = false;
      destroyed = false;
      writableLength = 0;
      writeHead() {
        return this;
      }
      write(chunk: string) {
        this.frames.push(chunk);
        return true;
      }
      end() {
        this.writableEnded = true;
        return this;
      }
      events() {
        return this.frames
          .filter((f) => f.startsWith('id: '))
          .map((f) => /event: (\S+)/.exec(f)![1]);
      }
    }
    const principal = (memberId: string): Principal => {
      const m = people.get(memberId)!;
      return {
        memberId,
        role: m.role,
        products: m.products,
        sessionId: `sess-${memberId}`,
        verifiedAt: 0,
        elevations: [],
      };
    };
    channels.set('redis-test-private', {
      id: 'redis-test-private',
      name: 'redis-test-private',
      kind: 'channel',
      topic: '',
      members: ['m4'],
      admins: ['m4'],
      private: true,
      createdBy: 'm4',
      createdAt: new Date(0).toISOString(),
      background: 'plain',
      permissions: { ...defaultPermissions },
    });
    const member = new FakeRes();
    const outsider = new FakeRes();
    openStream(principal('m4'), member as unknown as ServerResponse);
    openStream(principal('m10'), outsider as unknown as ServerResponse);
    const id = Date.now() * 1000;
    const at = new Date().toISOString();
    receiveRemote({
      id,
      type: 'message.created',
      at,
      audience: { channelId: 'redis-test-private' },
      data: {},
    });
    receiveRemote({
      id: id + 1,
      type: 'notification.created',
      at,
      audience: { memberId: 'm10' },
      data: {},
    });
    receiveRemote({ id: -1, type: 'bogus', at, audience: { memberId: 'm4' }, data: {} });
    assert.deepEqual(member.events(), ['message.created']);
    assert.deepEqual(outsider.events(), ['notification.created']);
    assert.ok(streamStats().lastEventId >= id + 1, 'local ids continue after remote ones');
    member.emit('close');
    outsider.emit('close');
  });
});
