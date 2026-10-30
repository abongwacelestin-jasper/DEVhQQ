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

  return {
    env,
    isProd,
    port,
    version: process.env.APP_VERSION ?? '1.4.0',
    appOrigin,
    publicUrl,
    allowedOrigins: [...new Set([appOrigin, publicUrl, ...devOrigins, ...extra])],
    rpId: required('WEBAUTHN_RP_ID', new URL(appOrigin).hostname),
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
    crypto: {
      mac: 'sha256',
      passwordKdf: 'scrypt-v1',
      webauthnAlgorithms: [-7 /* ES256 */, -257 /* RS256 */],
    },
    backups: {
      dir: process.env.BACKUP_DIR ?? './.backups',
      retentionDays: int('BACKUP_RETENTION_DAYS', 35),
    },
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
    crypto: config.crypto,
    backups: config.backups,
    secrets: {
      SESSION_SECRET: process.env.SESSION_SECRET ? 'set' : 'dev fallback',
      SESSION_SECRET_PREVIOUS: config.sessionSecretPrevious ? 'set' : 'not set',
      DEMO_TOTP_SECRET: process.env.DEMO_TOTP_SECRET ? 'set' : 'not set',
    },
    node: process.version,
  };
}
