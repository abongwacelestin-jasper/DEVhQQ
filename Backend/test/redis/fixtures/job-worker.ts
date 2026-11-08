/**
 * A minimal worker process for the exactly-once test: the real scheduler
 * (lib/scheduler.ts) with the real Redis lease, running one job every
 * JOB_INTERVAL_MS that records `<slot> <worker>` in a Redis list. Started
 * twice by test/redis/jobs.test.ts; stops itself after JOB_RUN_MS.
 */

import { createRedisClient } from '../../../lib/redis.ts';
import { RedisJobLock, scheduleEvery, setJobLock } from '../../../lib/scheduler.ts';

const url = process.env.REDIS_TEST_URL ?? '';
const prefix = process.env.JOB_PREFIX ?? '';
const name = process.env.WORKER_NAME ?? 'worker';
const interval = Number(process.env.JOB_INTERVAL_MS);
const runFor = Number(process.env.JOB_RUN_MS);

const c = createRedisClient(url, name);
await c.connect();
setJobLock(new RedisJobLock(c, prefix, name));
const stop = scheduleEvery(
  'probe',
  interval,
  async (slot) => {
    await c.rPush(`${prefix}runs`, `${slot} ${name}`);
  },
  { tickMs: 10, skipCurrentSlot: false },
);
process.stdout.write('ready\n');
setTimeout(() => {
  stop();
  void c.close().then(() => process.exit(0));
}, runFor);
