/**
 * `npm run test:redis`: the Redis suites against a real Redis.
 *
 * With REDIS_TEST_URL set, uses that server (it must be disposable: tests
 * write under unique `t:*` prefixes and delete them). Otherwise starts a
 * throwaway `redis:7-alpine` container on a free loopback port, runs the
 * suites, and removes the container whatever the outcome. Exit code is the
 * test runner's.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = fileURLToPath(new URL('../../', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function startRedis(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const name = `devhq-test-redis-${process.pid}-${port}`;
  const run = spawnSync(
    'docker',
    ['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:6379`, 'redis:7-alpine'],
    { encoding: 'utf8' },
  );
  if (run.status !== 0)
    throw new Error(`could not start redis:7-alpine (is Docker running?)\n${run.stderr}`);
  const stop = () => void spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const ping = spawnSync('docker', ['exec', name, 'redis-cli', 'ping'], { encoding: 'utf8' });
    if (ping.stdout?.trim() === 'PONG') return { url: `redis://127.0.0.1:${port}`, stop };
    await new Promise((r) => setTimeout(r, 200));
  }
  stop();
  throw new Error('redis container did not answer PING');
}

const own = process.env.REDIS_TEST_URL ? undefined : await startRedis();
const url = process.env.REDIS_TEST_URL ?? own!.url;
process.stdout.write(`redis suites → ${url}${own ? ' (throwaway container)' : ''}\n`);

const child = spawn(
  process.execPath,
  [
    '--experimental-strip-types',
    '--import',
    './test/setup.ts',
    '--test',
    '--test-concurrency=1',
    'test/redis/*.test.ts',
  ],
  { cwd: BACKEND_DIR, stdio: 'inherit', env: { ...process.env, REDIS_TEST_URL: url } },
);
const stopAndExit = (code: number) => {
  own?.stop();
  process.exit(code);
};
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', (code) => stopAndExit(code ?? 1));
