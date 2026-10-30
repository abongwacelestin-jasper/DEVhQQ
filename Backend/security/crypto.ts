/**
 * Cryptographic primitives — all from node:crypto, no third-party code.
 *
 * - Passwords: scrypt (memory-hard) with a per-password random salt.
 *   The stored string embeds the KDF id and parameters so we can raise cost
 *   or migrate algorithms transparently on the user's next successful login.
 * - Comparisons: always constant-time to avoid timing side channels.
 * - Tokens: 256-bit random values, signed with HMAC so tampering is detected
 *   before any database lookup.
 */

import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { config } from '../config/env.ts';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLen: 64, maxmem: 64 * 1024 * 1024 };

/** Returns `scrypt-v1$N$r$p$salt$hash` (base64url parts). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return [
    'scrypt-v1',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  const [kdf, N, r, p, saltB64, hashB64] = stored.split('$');
  if (kdf !== 'scrypt-v1' || !saltB64 || !hashB64) return { ok: false, needsRehash: false };
  const expected = Buffer.from(hashB64, 'base64url');
  const key = await scrypt(
    password.normalize('NFKC'),
    Buffer.from(saltB64, 'base64url'),
    expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem },
  );
  const ok = safeEqual(key, expected);
  return { ok, needsRehash: ok && Number(N) < SCRYPT.N };
}

/**
 * A precomputed hash used when the email doesn't exist, so "unknown user" and
 * "wrong password" take the same time — prevents account enumeration.
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

export function safeEqual(a: Buffer | string, b: Buffer | string): boolean {
  const x = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const y = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (x.length !== y.length) {
    timingSafeEqual(x, x); // keep timing uniform
    return false;
  }
  return timingSafeEqual(x, y);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmac(value: string, key = config.sessionSecret): string {
  return createHmac(config.crypto.mac, key).update(value).digest('base64url');
}

/** `<id>.<mac>` — the id is random, the mac proves we issued it. */
export function signToken(id: string): string {
  return `${id}.${hmac(id)}`;
}

/** Verifies against the current key, then the previous key (supports zero-downtime rotation). */
export function verifySignedToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (safeEqual(mac, hmac(id))) return id;
  if (config.sessionSecretPrevious && safeEqual(mac, hmac(id, config.sessionSecretPrevious)))
    return id;
  return null;
}
