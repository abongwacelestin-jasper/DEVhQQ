/**
 * Test harness for the TavetaHQ CYBER (offensive assessment) suite.
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
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = fileURLToPath(new URL('../../Backend/', import.meta.url));

/**
 * A loopback port the OS confirms is free right now. Guessing ports let a check talk to some
 * other process already listening there (e.g. a stray dev server) and report its behaviour.
 */
function freePort(): Promise<number> {
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
  const port = await freePort();
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
  // Generous on a loaded machine: SECURITY_READY_MS=60000 (default 8 s).
  const deadline = Date.now() + Number(process.env.SECURITY_READY_MS ?? 8000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      stop();
      throw new Error(`server exited early (code ${child.exitCode})\n${buf}`);
    }
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      // Only our own child counts: a server that is refusing to boot must not be
      // mistaken for whatever else answers on the port.
      if (r.ok && child.exitCode === null) return { base, port, stop, log: () => buf };
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
 * Since SEC (wave 4) browsers get cookie-only sessions; a body token is only
 * issued to non-browser clients: `X-DevHQ-Client: cli` with no Origin and no
 * Sec-Fetch-Site header.
 */
export async function signInDemo(base: string, role: string): Promise<string> {
  const r = await req(base, 'POST', '/api/auth/demo', {
    body: { role },
    headers: { 'x-devhq-client': 'cli' },
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

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so checks can complete real enrollments. */
export function totp(base32Secret: string, now = Date.now(), drift = 0): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of base32Secret.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Math.floor(now / 30_000) + drift;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** CLI-style (body-token) request helpers: no Origin, X-DevHQ-Client: cli. */
export const CLI = { 'x-devhq-client': 'cli' } as const;

/**
 * Creates a real, factor-less, non-seeded member through the Owner invite →
 * accept-invite flow and returns its credentials. Uses a fresh Owner demo
 * session, which is strongly verified (satisfies step-up) at sign-in.
 */
export async function inviteMember(
  base: string,
  email: string,
  role = 'Developer',
  products = ['renewberry'],
): Promise<{ email: string; password: string }> {
  const owner = await signInDemo(base, 'admin');
  const inv = await req(base, 'POST', '/api/team/invites', {
    token: owner,
    headers: CLI,
    body: { email, role, products },
  });
  const link: string | undefined = inv.json?.inviteLink;
  const tok = link ? new URL(link, 'http://x').searchParams.get('token') : null;
  if (!tok) throw new Error(`invite failed: ${inv.status} ${inv.text}`);
  const password = 'Cyber-Probe-Passw0rd!';
  const acc = await req(base, 'POST', '/api/auth/accept-invite', {
    headers: CLI,
    body: { token: tok, password },
  });
  if (acc.status !== 200) throw new Error(`accept-invite failed: ${acc.status} ${acc.text}`);
  return { email, password };
}

/** Password step only: returns the partial (pre-MFA) bearer token. */
export async function passwordStep(base: string, email: string, password: string): Promise<string> {
  const r = await req(base, 'POST', '/api/auth/sign-in', { headers: CLI, body: { email, password } });
  if (!r.json?.token) throw new Error(`password step failed: ${r.status} ${r.text}`);
  return r.json.token as string;
}

/** Simple statistics helper for timing analysis (median + percentile). */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
