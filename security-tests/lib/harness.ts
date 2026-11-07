/**
 * Test harness for the DevHQ CYBER (offensive assessment) suite.
 *
 * Dependency-free. Boots the real backend (Backend/server.ts) as a child
 * process on a loopback-only ephemeral port with fresh, isolated state
 * (temp BACKUP_DIR / AUDIT_LOG_FILE), waits for the readiness probe, and
 * hands the check a small HTTP client plus demo sign-in helpers.
 *
 * Rules of engagement: every target is a process this harness starts on
 * 127.0.0.1. Nothing here reaches an external host.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = fileURLToPath(new URL('../../Backend/', import.meta.url));

let nextPort = 8100 + Math.floor(Math.random() * 400);

export interface Server {
  base: string;
  port: number;
  stop: () => void;
  /** Lines the child wrote to stdout/stderr (for diagnostics). */
  log: () => string;
}

export interface ServerOpts {
  env?: Record<string, string>;
}

export async function spawnServer(opts: ServerOpts = {}): Promise<Server> {
  const port = nextPort++;
  const dir = mkdtempSync(join(tmpdir(), 'devhq-cyber-'));
  const child: ChildProcess = spawn(
    process.execPath,
    ['--experimental-strip-types', 'server.ts'],
    {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(port),
        SESSION_SECRET: 'cyber-test-secret-0123456789abcdef0123456789abcdef',
        APP_ORIGIN: 'http://localhost:5173',
        PUBLIC_URL: `http://127.0.0.1:${port}`,
        BACKUP_DIR: join(dir, 'backups'),
        AUDIT_LOG_FILE: join(dir, 'audit.log'),
        LOG_LEVEL: 'warn',
        ...opts.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let buf = '';
  child.stdout?.on('data', (d) => (buf += d));
  child.stderr?.on('data', (d) => (buf += d));

  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  // Wait for readiness (seed loaded + audit chain intact).
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      stop();
      throw new Error(`server exited early (code ${child.exitCode})\n${buf}`);
    }
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return { base, port, stop, log: () => buf };
    } catch {
      /* not up yet */
    }
    await sleep(120);
  }
  stop();
  throw new Error(`server did not become ready on :${port}\n${buf}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Res {
  status: number;
  headers: Headers;
  json: any;
  text: string;
  setCookie: string[];
}

export interface ReqOpts {
  token?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** send a raw (already-serialized) body instead of JSON.stringify(body) */
  rawBody?: string;
  origin?: string;
  ua?: string;
}

export async function req(
  base: string,
  method: string,
  path: string,
  o: ReqOpts = {},
): Promise<Res> {
  const headers: Record<string, string> = {
    'user-agent': o.ua ?? 'cyber-suite/1.0',
    ...o.headers,
  };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.origin) headers.origin = o.origin;
  let body: string | undefined;
  if (o.rawBody !== undefined) {
    body = o.rawBody;
    headers['content-type'] ??= 'application/json';
  } else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers['content-type'] ??= 'application/json';
  }
  const r = await fetch(`${base}${path}`, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: r.status, headers: r.headers, json, text, setCookie: r.headers.getSetCookie() };
}

/**
 * Demo sign-in by role, returning a fully-verified bearer token.
 * `X-DevHQ-Client: console` makes the API echo the token in the body.
 */
export async function signInDemo(base: string, role: string): Promise<string> {
  const r = await req(base, 'POST', '/api/auth/demo', {
    body: { role },
    origin: 'http://localhost:5173',
    headers: { 'x-devhq-client': 'console' },
    ua: 'cyber-suite/1.0',
  });
  if (r.status !== 200 || !r.json?.token)
    throw new Error(`demo sign-in (${role}) failed: ${r.status} ${r.text}`);
  return r.json.token as string;
}

export async function demoAccounts(
  base: string,
): Promise<{ enabled: boolean; password: string; mfaCode: string; accounts: any[] }> {
  const r = await req(base, 'GET', '/api/auth/demo-accounts');
  return r.json;
}

// ── Result types shared with the runner ──────────────────────────
export type Status = 'pass' | 'fail' | 'skip';
export interface Finding {
  status: Status;
  /** One-line human summary. */
  detail: string;
  /** Finding id when this check maps to a report finding. */
  id?: string;
}
export interface Check {
  name: string;
  /** Short category for the table. */
  area: string;
  /** Extra env the server needs for this check. */
  env?: Record<string, string>;
  run: (base: string, server: Server) => Promise<Finding>;
}

/** Simple statistics helper for timing analysis (median + percentile). */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
