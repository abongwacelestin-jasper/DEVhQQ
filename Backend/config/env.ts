/**
 * Runtime configuration.
 *
 * Every secret is read from the environment — nothing sensitive is committed.
 * The server refuses to boot in production with missing or weak secrets
 * (fail closed rather than run with a default key).
 *
 * Cryptographic algorithms are referenced by identifier rather than hard-coded
 * at call sites. That is our "crypto agility" seam: when post-quantum
 * algorithms (ML-KEM for key exchange, ML-DSA for signatures) are available in
 * the runtime, they can be rolled out by changing configuration and rotating
 * keys, not by rewriting code.
 */

import { hkdfSync } from 'node:crypto';

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  env: NodeEnv;
  isProd: boolean;
  port: number;
  version: string;
  /** Public origin of the web app — used for CORS, CSRF origin checks and WebAuthn. */
  appOrigin: string;
  /** Public URL of this API (the console is served from here). */
  publicUrl: string;
  /** Every origin allowed to make credentialed, state-changing calls. */
  allowedOrigins: string[];
  /** WebAuthn relying-party ID: the registrable domain, e.g. "devhq.app". */
  rpId: string;
  rpName: string;
  /** HMAC key for signing session tokens. Must be ≥ 32 random bytes (hex). */
  sessionSecret: string;
  /** Previous key accepted for verification only, so keys can rotate without logging everyone out. */
  sessionSecretPrevious?: string;
  /** Idle timeout before a session must be re-verified. */
  sessionIdleMs: number;
  /** Absolute lifetime — sessions end after this regardless of activity. */
  sessionAbsoluteMs: number;
  /** Maximum JSON body size accepted by any route. */
  maxBodyBytes: number;
  rateLimits: {
    api: { capacity: number; refillPerSec: number };
    auth: { capacity: number; refillPerSec: number };
  };
  /** Per-account bucket for credential checks (password, TOTP, passkey) regardless of source IP. */
  accountRateLimit: { capacity: number; refillPerSec: number };
  crypto: {
    /** HMAC algorithm for tokens. */
    mac: 'sha256' | 'sha384' | 'sha512';
    /** Password KDF identifier — stored alongside each hash so it can be upgraded on next login. */
    passwordKdf: 'scrypt-v1';
    /** Signature algorithms accepted for WebAuthn credentials (COSE identifiers). */
    webauthnAlgorithms: number[];
  };
  backups: {
    dir: string;
    retentionDays: number;
  };
  /**
   * Data-encryption keys for secrets at rest (TOTP seeds, third-party tokens).
   * `current` seals new values; `previous` keys only open old ones so keys can
   * rotate without a flag day. Each key is 32 bytes (64 hex chars).
   */
  dataEncryption: {
    current: Buffer;
    previous: Buffer[];
    /** 'env' when DATA_ENCRYPTION_KEY is set; 'dev-derived' only outside production. */
    source: 'env' | 'dev-derived';
  };
  /** Origins accepted in WebAuthn clientDataJSON. Same registrable domain as `rpId`. */
  webauthnOrigins: string[];
}

function hexKey(name: string, raw: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(raw))
    throw new Error(`${name} must be exactly 32 bytes encoded as 64 hex characters`);
  return Buffer.from(raw, 'hex');
}

/**
 * Production fails closed without a real data-encryption key. Development
 * derives a stable key from the session secret so local data survives a
 * restart; that key is labelled `dev-derived` and never used in production.
 */
function loadDataEncryption(isProd: boolean, sessionSecret: string): AppConfig['dataEncryption'] {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  const previous = (process.env.DATA_ENCRYPTION_KEYS_PREVIOUS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((k, i) => hexKey(`DATA_ENCRYPTION_KEYS_PREVIOUS[${i}]`, k));
  if (raw) return { current: hexKey('DATA_ENCRYPTION_KEY', raw), previous, source: 'env' };
  if (isProd) throw new Error('Missing required environment variable DATA_ENCRYPTION_KEY');
  const derived = Buffer.from(
    hkdfSync('sha256', sessionSecret, 'devhq-dev-data-key', 'devhq/data-encryption/v1', 32),
  );
  return { current: derived, previous, source: 'dev-derived' };
}

/** COSE algorithms we can verify with node:crypto: ES256, EdDSA (Ed25519), RS256. */
const SUPPORTED_WEBAUTHN_ALGS = [-7, -8, -257];

function webauthnAlgorithms(): number[] {
  const raw = process.env.WEBAUTHN_ALGORITHMS;
  if (!raw) return [-7 /* ES256 */, -257 /* RS256 */];
  const algs = raw.split(',').map((s) => Number.parseInt(s.trim(), 10));
  if (!algs.length || algs.some((a) => !SUPPORTED_WEBAUTHN_ALGS.includes(a)))
    throw new Error(`WEBAUTHN_ALGORITHMS must be a subset of ${SUPPORTED_WEBAUTHN_ALGS.join(',')}`);
  return [...new Set(algs)];
}

/**
 * Demo accounts and the shared demo code exist for local evaluation only.
 * A production process with any DEMO_* credential variable set refuses to
 * boot (DEMO_DISABLED is the one allowed, since it only turns demo off).
 */
function assertNoDemoInProduction(isProd: boolean) {
  if (!isProd) return;
  const offending = Object.keys(process.env).filter(
    (k) => k.startsWith('DEMO_') && k !== 'DEMO_DISABLED' && (process.env[k] ?? '') !== '',
  );
  if (offending.length)
    throw new Error(`Demo settings are not allowed in production: ${offending.sort().join(', ')}`);
}

function required(name: string, fallbackForDev?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (process.env.NODE_ENV !== 'production' && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}

function int(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function loadConfig(): AppConfig {
  const env = (process.env.NODE_ENV as NodeEnv) ?? 'development';
  const isProd = env === 'production';
  assertNoDemoInProduction(isProd);
  const sessionSecret = required(
    'SESSION_SECRET',
    'dev-only-secret-change-me-0123456789abcdef0123456789',
  );

  if (isProd && sessionSecret.length < 64) {
    throw new Error(
      'SESSION_SECRET must be at least 32 bytes encoded as hex (64 chars) in production',
    );
  }

  const port = int('PORT', 8080);
  const appOrigin = required('APP_ORIGIN', 'http://localhost:5173');
  const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  const extra = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const devOrigins = isProd ? [] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const rpId = required('WEBAUTHN_RP_ID', new URL(appOrigin).hostname);
  // A WebAuthn origin must be the RP ID itself or one of its subdomains.
  const webauthnOrigins = [appOrigin, publicUrl].filter((o, i, all) => {
    const host = new URL(o).hostname;
    return all.indexOf(o) === i && (host === rpId || host.endsWith(`.${rpId}`));
  });

  return {
    env,
    isProd,
    port,
    version: process.env.APP_VERSION ?? '1.4.0',
    appOrigin,
    publicUrl,
    allowedOrigins: [...new Set([appOrigin, publicUrl, ...devOrigins, ...extra])],
    rpId,
    rpName: process.env.WEBAUTHN_RP_NAME ?? 'DevHQ',
    sessionSecret,
    sessionSecretPrevious: process.env.SESSION_SECRET_PREVIOUS,
    sessionIdleMs: int('SESSION_IDLE_MS', 15 * 60_000),
    sessionAbsoluteMs: int('SESSION_ABSOLUTE_MS', 12 * 60 * 60_000),
    maxBodyBytes: int('MAX_BODY_BYTES', 256 * 1024),
    // Development is more forgiving so the console and test suites don't trip limits.
    rateLimits: isProd
      ? { api: { capacity: 120, refillPerSec: 2 }, auth: { capacity: 10, refillPerSec: 0.1 } }
      : { api: { capacity: 600, refillPerSec: 20 }, auth: { capacity: 60, refillPerSec: 1 } },
    accountRateLimit: isProd
      ? { capacity: 5, refillPerSec: 1 / 30 }
      : { capacity: 30, refillPerSec: 1 },
    crypto: {
      mac: 'sha256',
      passwordKdf: 'scrypt-v1',
      webauthnAlgorithms: webauthnAlgorithms(),
    },
    backups: {
      dir: process.env.BACKUP_DIR ?? './.backups',
      retentionDays: int('BACKUP_RETENTION_DAYS', 35),
    },
    dataEncryption: loadDataEncryption(isProd, sessionSecret),
    webauthnOrigins,
  };
}

export const config = loadConfig();

/** Redacted view for the console — secrets are reported as present/absent only. */
export function publicConfig() {
  return {
    env: config.env,
    version: config.version,
    port: config.port,
    appOrigin: config.appOrigin,
    publicUrl: config.publicUrl,
    allowedOrigins: config.allowedOrigins,
    rpId: config.rpId,
    sessionIdleMinutes: config.sessionIdleMs / 60_000,
    sessionAbsoluteHours: config.sessionAbsoluteMs / 3_600_000,
    maxBodyKb: config.maxBodyBytes / 1024,
    rateLimits: config.rateLimits,
    accountRateLimit: config.accountRateLimit,
    webauthnOrigins: config.webauthnOrigins,
    crypto: config.crypto,
    backups: config.backups,
    secrets: {
      SESSION_SECRET: process.env.SESSION_SECRET ? 'set' : 'dev fallback',
      SESSION_SECRET_PREVIOUS: config.sessionSecretPrevious ? 'set' : 'not set',
      DEMO_TOTP_SECRET: process.env.DEMO_TOTP_SECRET ? 'set' : 'not set',
      DATA_ENCRYPTION_KEY: config.dataEncryption.source === 'env' ? 'set' : 'dev fallback',
      DATA_ENCRYPTION_KEYS_PREVIOUS: `${config.dataEncryption.previous.length} key(s)`,
    },
    node: process.version,
  };
}
