/**
 * Cryptographic primitives — all from node:crypto, no third-party code.
 *
 * - Passwords: scrypt (memory-hard) with a per-password random salt.
 *   The stored string embeds the KDF id and parameters so we can raise cost
 *   or migrate algorithms transparently on the user's next successful login.
 * - Comparisons: always constant-time to avoid timing side channels.
 * - Tokens: 256-bit random values, signed with HMAC so tampering is detected
 *   before any database lookup.
 * - Secrets at rest (TOTP seeds, third-party OAuth/API tokens): AES-256-GCM
 *   envelope with a key id, a per-value random IV and a caller-supplied
 *   context bound as additional authenticated data (see `seal` / `open`).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
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

/**
 * One-way digest for single-use bearer tokens (invites, resets). Only the hash
 * is stored, so a database leak alone can't be replayed against the API.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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

// ---------------------------------------------------------------------------
// Encryption at rest (AES-256-GCM)
// ---------------------------------------------------------------------------

/**
 * Sealed value layout (all parts base64url, colon separated):
 *
 *   enc:v1:<keyId>:<iv 12 bytes>:<ciphertext>:<tag 16 bytes>
 *
 * - keyId is derived from the key itself (first 64 bits of a labelled
 *   SHA-256), so operators rotate by setting a new DATA_ENCRYPTION_KEY and
 *   moving the old one to DATA_ENCRYPTION_KEYS_PREVIOUS — no id bookkeeping.
 * - The AAD is `devhq:enc:v1:<keyId>:<context>`. Callers pass a context such as
 *   `member:m4:totp`, so a ciphertext copied onto another row or field fails
 *   authentication instead of decrypting.
 *
 * Usage from any lane:
 *
 *   import { seal, open } from '../security/crypto.ts';
 *   row.accessToken = seal(token, `github-installation:${row.id}:access-token`);
 *   const token = open(row.accessToken, `github-installation:${row.id}:access-token`);
 */
const SEAL_PREFIX = 'enc:v1:';

function keyIdOf(key: Buffer): string {
  return createHash('sha256')
    .update('devhq-data-key-id:')
    .update(key)
    .digest()
    .subarray(0, 8)
    .toString('base64url');
}

const dataKeys: { current: { id: string; key: Buffer }; byId: Map<string, Buffer> } = (() => {
  const current = {
    id: keyIdOf(config.dataEncryption.current),
    key: config.dataEncryption.current,
  };
  const byId = new Map<string, Buffer>([[current.id, current.key]]);
  for (const k of config.dataEncryption.previous) byId.set(keyIdOf(k), k);
  return { current, byId };
})();

/** Id of the key that seals new values (safe to display; reveals nothing about the key). */
export function dataKeyId(): string {
  return dataKeys.current.id;
}

function aad(keyId: string, context: string): Buffer {
  return Buffer.from(`devhq:enc:v1:${keyId}:${context}`, 'utf8');
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Encrypts `plaintext` with the current data key. `context` must be identical when opening. */
export function seal(plaintext: string, context: string): string {
  if (!context) throw new Error('seal() requires a context');
  const { id, key } = dataKeys.current;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(id, context));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SEAL_PREFIX}${id}:${iv.toString('base64url')}:${ct.toString('base64url')}:${tag.toString('base64url')}`;
}

export function isSealed(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.startsWith(SEAL_PREFIX);
}

/**
 * Decrypts a sealed value with whichever configured key sealed it. Throws a
 * DecryptionError for unknown keys, malformed input or a failed tag check —
 * never returns partial plaintext.
 */
export function open(sealed: string, context: string): string {
  if (!isSealed(sealed)) throw new DecryptionError('Value is not sealed');
  const parts = sealed.slice(SEAL_PREFIX.length).split(':');
  if (parts.length !== 4) throw new DecryptionError('Malformed sealed value');
  const [keyId, ivB64, ctB64, tagB64] = parts;
  const key = dataKeys.byId.get(keyId);
  if (!key) throw new DecryptionError(`No data key with id ${keyId} is configured`);
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new DecryptionError('Malformed sealed value');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(aad(keyId, context));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DecryptionError('Sealed value failed authentication');
  }
}

/** True when a value is plaintext or sealed under a non-current key — i.e. it should be re-sealed. */
export function needsReseal(value: string): boolean {
  return !isSealed(value) || !value.startsWith(`${SEAL_PREFIX}${dataKeys.current.id}:`);
}

/**
 * Returns the value sealed under the current key. Accepts legacy plaintext
 * (migration) and values sealed with a previous key (rotation).
 */
export function reseal(value: string, context: string): string {
  if (!needsReseal(value)) return value;
  return seal(isSealed(value) ? open(value, context) : value, context);
}
