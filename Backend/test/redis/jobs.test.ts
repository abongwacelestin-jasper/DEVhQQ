import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BACKEND_DIR,
  client,
  closeClient,
  dropPrefix,
  redisProxy,
  REDIS_URL,
  uniquePrefix,
  until,
} from './helpers.ts';
import { createRedisClient, type RedisClient } from '../../lib/redis.ts';
import { RedisJobLock, runExclusive, scheduleEvery, setJobLock } from '../../lib/scheduler.ts';

const WORKER = fileURLToPath(new URL('./fixtures/job-worker.ts', import.meta.url));

let c: RedisClient;
const prefixes: string[] = [];
function prefix(tag: string) {
  const p = uniquePrefix(tag);
  prefixes.push(p);
  return p;
}

before(async () => {
  c = await client(undefined, 'jobs');
});
after(async () => {
  for (const p of prefixes) await dropPrefix(c, p);
  await closeClient(c);
});

function runWorker(name: string, env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', WORKER], {
      cwd: BACKEND_DIR,
      env: { PATH: process.env.PATH ?? '', REDIS_TEST_URL: REDIS_URL, WORKER_NAME: name, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve(code) : reject(new Error(`${name}: ${err}`)),
    );
  });
}

describe('job leases — exactly once across processes', () => {
  it('two worker processes running the same 200 ms job: no slot runs twice', async () => {
    const p = prefix('two-workers');
    const env = { JOB_PREFIX: p, JOB_INTERVAL_MS: '200', JOB_RUN_MS: '4000' };
    await Promise.all([runWorker('w1', env), runWorker('w2', env)]);

    const runs = await c.lRange(`${p}runs`, 0, -1);
    const bySlot = new Map<number, string[]>();
    for (const r of runs) {
      const [slot, who] = r.split(' ');
      bySlot.set(Number(slot), [...(bySlot.get(Number(slot)) ?? []), who]);
    }
    const doubled = [...bySlot].filter(([, who]) => who.length > 1);
    assert.deepEqual(doubled, [], 'no slot ran twice');
    // ~20 slots in 4 s. A heavily loaded machine may tick late, so only require
    // that the job kept running; the property under test is "never twice".
    assert.ok(bySlot.size >= 4, `the job kept running (${bySlot.size} slots)`);
  });

  it('runExclusive: of 100 concurrent contenders on two connections, exactly one runs', async () => {
    const p = prefix('race');
    const c2 = await client(undefined, 'jobs-2');
    try {
      const locks = [new RedisJobLock(c, p, 'a'), new RedisJobLock(c2, p, 'b')];
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) => locks[i % 2].tryAcquire('monitor:mon-1', 5_000)),
      );
      assert.equal(results.filter(Boolean).length, 1);
      assert.ok((await c.pTTL(`${p}lock:monitor:mon-1`)) > 0, 'the lease expires');
    } finally {
      await closeClient(c2);
    }
  });

  it('Redis down: the run is skipped (never run without the lease) and retried in the same slot', async () => {
    const p = prefix('down');
    const proxy = await redisProxy();
    const pc = createRedisClient(proxy.url, 'jobs-down');
    await pc.connect();
    let ran = 0;
    try {
      setJobLock(new RedisJobLock(pc, p, 'solo', 10_000));
      await proxy.cut();
      assert.ok(await until(() => !pc.isReady));
      assert.equal(await runExclusive('x', 1_000, () => ran++), 'lock_unavailable');
      assert.equal(ran, 0);

      // A slot-aligned job keeps retrying its slot until the lease can be taken.
      const stop = scheduleEvery('down-probe', 60_000, () => ran++, {
        tickMs: 20,
        skipCurrentSlot: false,
      });
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(ran, 0, 'no run without Redis');
      await proxy.restore();
      assert.ok(await until(() => ran === 1), 'ran once Redis was back');
      await new Promise((r) => setTimeout(r, 200));
      stop();
      assert.equal(ran, 1, 'and only once for that slot');
    } finally {
      await closeClient(pc);
      await proxy.close();
    }
  });
});
