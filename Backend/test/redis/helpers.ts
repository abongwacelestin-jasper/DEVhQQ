/**
 * Helpers for the Redis suites (test/redis/*.test.ts, `npm run test:redis`).
 *
 * They need a real Redis: REDIS_TEST_URL (test/redis/run.ts starts a
 * throwaway `redis:7-alpine` container and sets it). Without it every suite
 * fails at load — never a silent skip. Each test uses its own key prefix, so
 * runs never see each other's keys and nothing needs FLUSHALL.
 */

import '../setup.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRedisClient, type RedisClient } from '../../lib/redis.ts';

export const REDIS_URL = process.env.REDIS_TEST_URL ?? '';
if (!REDIS_URL)
  throw new Error(
    'REDIS_TEST_URL is not set. Run `npm run test:redis` (starts a throwaway Redis in Docker) ' +
      'or point REDIS_TEST_URL at a disposable Redis 7.',
  );

export const BACKEND_DIR = fileURLToPath(new URL('../../', import.meta.url));

export function uniquePrefix(tag: string): string {
  return `t:${tag}:${randomUUID().slice(0, 8)}:`;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A connected client (a new connection: separate clients behave like separate replicas). */
export async function client(url = REDIS_URL, role = 'test'): Promise<RedisClient> {
  const c = createRedisClient(url, role);
  await c.connect();
  return c;
}

export async function closeClient(c: RedisClient) {
  if (c.isOpen) await c.close().catch(() => c.destroy());
  else c.destroy();
}

/** Deletes every key under a prefix (cleanup). */
export async function dropPrefix(c: RedisClient, prefix: string) {
  for await (const keys of c.scanIterator({ MATCH: `${prefix}*`, COUNT: 500 }))
    if (keys.length) await c.del(keys);
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/**
 * A TCP proxy in front of Redis. `cut()` drops every connection and refuses
 * new ones (a Redis outage as the app sees it); `restore()` accepts again.
 */
export interface RedisProxy {
  url: string;
  cut(): Promise<void>;
  restore(): Promise<void>;
  close(): Promise<void>;
}

export async function redisProxy(target = REDIS_URL): Promise<RedisProxy> {
  const t = new URL(target);
  const port = await freePort();
  const sockets = new Set<Socket>();
  let server: Server | undefined;
  const listen = () =>
    new Promise<void>((resolve) => {
      server = createServer((down) => {
        const up = connect(Number(t.port || 6379), t.hostname);
        sockets.add(down);
        sockets.add(up);
        const end = () => {
          down.destroy();
          up.destroy();
          sockets.delete(down);
          sockets.delete(up);
        };
        down.on('error', end).on('close', end);
        up.on('error', end).on('close', end);
        down.pipe(up).pipe(down);
      });
      server.listen(port, '127.0.0.1', () => resolve());
    });
  const stop = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      sockets.clear();
      if (!server) return resolve();
      server.close(() => resolve());
      server = undefined;
    });
  await listen();
  const auth = t.username || t.password ? `${t.username}:${t.password}@` : '';
  return {
    url: `redis://${auth}127.0.0.1:${port}${t.pathname}`,
    cut: stop,
    restore: listen,
    close: stop,
  };
}

// ── Real API processes ─────────────────────────────────────────────────────

export interface Instance {
  name: string;
  base: string;
  child: ChildProcess;
  log: () => string;
  stop: () => Promise<void>;
}

/** Boots `server.ts` as its own process (a replica), waits for /api/ready. */
export async function spawnInstance(name: string, env: Record<string, string>): Promise<Instance> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), `devhq-redis-${name}-`));
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server.ts'], {
    cwd: BACKEND_DIR,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'development',
      PORT: String(port),
      SESSION_SECRET: 'redis-suite-secret-0123456789abcdef0123456789abcdef',
      APP_ORIGIN: 'http://localhost:5173',
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      BACKUP_DIR: join(dir, 'backups'),
      AUDIT_LOG_FILE: join(dir, 'audit.jsonl'),
      LOG_LEVEL: 'warn',
      TRUST_PROXY: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout?.on('data', (d) => (buf += d));
  child.stderr?.on('data', (d) => (buf += d));
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGKILL');
      await gone;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited (${child.exitCode})\n${buf}`);
    try {
      const r = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return { name, base, child, log: () => buf, stop };
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  await stop();
  throw new Error(`${name} did not become ready\n${buf}`);
}

export interface CallOpts {
  token?: string;
  ip?: string;
  body?: unknown;
}

export async function call(
  base: string,
  method: string,
  path: string,
  o: CallOpts = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const r = await fetch(base + path, {
    method,
    headers: {
      'User-Agent': 'redis-suite/1.0',
      'X-DevHQ-Client': 'cli',
      'X-Forwarded-For': o.ip ?? '127.9.0.1',
      ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* not JSON */
  }
  return { status: r.status, json, headers: r.headers };
}

/** Demo sign-in on one instance (sessions are per process; see sessionStore.ts). */
export async function demoToken(base: string, role: string, ip: string): Promise<string> {
  const r = await call(base, 'POST', '/api/auth/demo', { body: { role }, ip });
  if (r.status !== 200 || typeof r.json.token !== 'string')
    throw new Error(`demo sign-in ${role} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.token;
}

export interface SseEvent {
  type: string;
  id?: string;
  data: unknown;
}

/** Opens an SSE stream and collects frames until `stop()` (or `ms`). */
export function collectSse(base: string, path: string, token: string, ip: string, ms = 8_000) {
  const ctrl = new AbortController();
  const events: SseEvent[] = [];
  let opened!: () => void;
  const open = new Promise<void>((r) => (opened = r));
  const done = (async () => {
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(base + path, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
          'User-Agent': 'redis-suite/1.0',
          'X-Forwarded-For': ip,
        },
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) throw new Error(`stream ${path} → ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const type = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          const id = /^id: (.+)$/m.exec(frame)?.[1];
          if (!type || !data) continue;
          events.push({ type, id, data: JSON.parse(data) });
          if (type === 'hello') opened();
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e;
    } finally {
      clearTimeout(timer);
      opened();
    }
  })();
  return {
    events,
    open,
    stop: async () => {
      ctrl.abort();
      await done;
      return events;
    },
  };
}

/** Polls until `pred()` holds or the deadline passes. */
export async function until(pred: () => boolean, ms = 20_000, step = 25): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await sleep(step);
  }
  return pred();
}
