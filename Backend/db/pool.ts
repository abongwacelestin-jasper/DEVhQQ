/**
 * PostgreSQL connection pool factory.
 *
 * TLS is controlled by `DATABASE_SSL`:
 *   - unset / `disable` — plain TCP (only for a private network, e.g. the
 *     compose `postgres` service; a warning is logged in production),
 *   - `require`        — encrypt, but do not verify the server certificate,
 *   - `verify-full`    — encrypt and verify the certificate chain and host name
 *                        (optionally against `DATABASE_SSL_CA`, a PEM file path).
 * Any other value is rejected at boot: misconfigured TLS fails closed.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { PoolConfig } from 'pg';
import { logger } from '../lib/logger.ts';

export type SslMode = 'disable' | 'require' | 'verify-full';

export function sslMode(raw = process.env.DATABASE_SSL): SslMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'disable' || v === 'false' || v === '0') return 'disable';
  if (v === 'require') return 'require';
  if (v === 'verify-full') return 'verify-full';
  throw new Error(`DATABASE_SSL must be one of disable | require | verify-full (got "${raw}")`);
}

function sslConfig(mode: SslMode): PoolConfig['ssl'] {
  if (mode === 'disable') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  const caPath = process.env.DATABASE_SSL_CA;
  return caPath
    ? { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') }
    : { rejectUnauthorized: true };
}

function positiveInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Strips credentials from a connection string so it can be logged. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'postgres://<unparseable>';
  }
}

export function createPool(connectionString: string, purpose: 'runtime' | 'migrate' = 'runtime') {
  const mode = sslMode();
  if (mode === 'disable' && process.env.NODE_ENV === 'production')
    logger.warn('db.tls_disabled', {
      hint: 'DATABASE_SSL is unset — only acceptable on a private network',
    });
  const pool = new pg.Pool({
    connectionString,
    ssl: sslConfig(mode),
    // ≥ 2: boot holds one client for the seed lock while hydrating with another.
    max: purpose === 'migrate' ? 2 : Math.max(2, positiveInt('DATABASE_POOL_MAX', 10)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: positiveInt('DATABASE_CONNECT_TIMEOUT_MS', 5_000),
    statement_timeout:
      purpose === 'migrate' ? 0 : positiveInt('DATABASE_STATEMENT_TIMEOUT_MS', 15_000),
    application_name: `devhq-backend-${purpose}`,
  });
  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => logger.error('db.pool_error', { err: String(err) }));
  return pool;
}
