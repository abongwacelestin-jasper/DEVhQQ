/**
 * DoS / Authentication — rate limits must hold across two backend replicas.
 *
 * With per-process buckets, an attacker behind a load balancer gets the
 * auth budget once per replica (N replicas = N× the password / TOTP
 * guesses). With REDIS_URL both replicas share one bucket per key
 * (Backend/security/rateLimitRedis.ts).
 *
 * PoC: boot two backends on one Redis, fire a concurrent burst at an
 * auth-limited route split across both, and count what got through. Fails if
 * more than one budget (dev capacity 60, plus refill) was granted.
 *
 * Needs a Redis: REDIS_TEST_URL, or Docker (a throwaway redis:7-alpine is
 * started on a free loopback port and removed afterwards). Without either the
 * check is SKIP, never PASS.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { req, sleep, spawnServer, type Check, type Server } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

const CAPACITY = 60; // dev auth bucket (Backend/config/env.ts)

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function redis(): Promise<{ url: string; stop: () => void } | undefined> {
  if (process.env.REDIS_TEST_URL) return { url: process.env.REDIS_TEST_URL, stop: () => {} };
  const port = await freePort();
  const name = `devhq-cyber-redis-${process.pid}-${port}`;
  const run = spawnSync(
    'docker',
    ['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:6379`, 'redis:7-alpine'],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) return undefined;
  const stop = () => void spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    const ping = spawnSync('docker', ['exec', name, 'redis-cli', 'ping'], { encoding: 'utf8' });
    if (ping.stdout?.trim() === 'PONG') return { url: `redis://127.0.0.1:${port}`, stop };
    await sleep(200);
  }
  stop();
  return undefined;
}

export const check: Check = {
  name: 'Rate limits shared across two replicas (Redis)',
  area: 'Authentication / DoS',
  run: async () => {
    const r = await redis();
    if (!r) return { status: 'skip', detail: 'no REDIS_TEST_URL and Docker unavailable' };
    const servers: Server[] = [];
    try {
      const env = {
        REDIS_URL: r.url,
        REDIS_KEY_PREFIX: `cyber:${randomUUID().slice(0, 8)}:`,
        EXPECT_REPLICAS: '2',
        REDIS_COMMAND_TIMEOUT_MS: '10000',
      };
      servers.push(...(await Promise.all([spawnServer({ env }), spawnServer({ env })])));
      const [a, b] = servers;
      const ready = await Promise.all(servers.map((s) => req(s.base, 'GET', '/api/ready')));
      if (ready.some((x) => x.json?.redis !== 'up'))
        return { status: 'fail', detail: `Redis not up on both replicas: ${ready.map((x) => x.text)}` };

      const BURST = 2 * CAPACITY;
      const started = Date.now();
      const statuses = await Promise.all(
        Array.from({ length: BURST }, (_, i) =>
          req(i % 2 ? a.base : b.base, 'POST', '/api/auth/webauthn/options', {
            origin: 'http://localhost:5173',
          }).then((x) => x.status),
        ),
      );
      const refill = Math.ceil((Date.now() - started) / 1000);
      const granted = statuses.filter((s) => s !== 429).length;
      const ok = granted <= CAPACITY + refill;
      return {
        status: ok ? 'pass' : 'fail',
        id: 'INFO-RL-REPLICAS',
        detail: ok
          ? `${granted}/${BURST} granted across 2 replicas (one budget of ${CAPACITY} + ${refill} refill)`
          : `${granted}/${BURST} granted across 2 replicas — each replica has its own budget`,
      };
    } finally {
      for (const s of servers) s.stop();
      r.stop();
    }
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
