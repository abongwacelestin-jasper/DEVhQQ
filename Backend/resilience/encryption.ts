/**
 * AES-256-GCM envelope for data at rest (backups).
 *
 * NOTE (dedup): SEC owns `DATA_ENCRYPTION_KEY` handling for TOTP secrets and
 * tokens. This is a local helper written because SEC's helper is not on this
 * branch; once SEC lands, the coordinator can point `encryptBlob`/`decryptBlob`
 * at SEC's implementation as long as the wire format below is preserved (or
 * old backups stay readable via the `v` byte).
 *
 * Format: "DHQE" | v=1 (1 byte) | keyId length (1) | keyId | iv (12) | tag (16) | ciphertext
 *  - keyId is a fingerprint of the key (never the key), so restore can say
 *    "encrypted with a different key" instead of "corrupt".
 *  - `aad` binds the ciphertext to its context (the backup id): a valid blob
 *    can't be swapped in under another id.
 *
 * Key: 32 bytes as 64 hex chars in DATA_ENCRYPTION_KEY. Production refuses to
 * encrypt without it. Outside production a key is derived from SESSION_SECRET
 * (HKDF) and tagged `dev-derived`.
 */

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config/env.ts';

const MAGIC = Buffer.from('DHQE');

interface Key {
  id: string;
  key: Buffer;
}

function loadKey(): Key {
  const hex = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex))
      throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters');
    const key = Buffer.from(hex, 'hex');
    return { id: 'dek-' + createHash('sha256').update(key).digest('hex').slice(0, 12), key };
  }
  if (config.isProd) throw new Error('DATA_ENCRYPTION_KEY is required in production');
  const key = Buffer.from(
    hkdfSync('sha256', config.sessionSecret, 'devhq', 'backup-encryption-dev', 32),
  );
  return { id: 'dev-derived', key };
}

export function encryptionKeyId(): string {
  return loadKey().id;
}

export function encryptBlob(plain: Buffer, aad: string): Buffer {
  const { id, key } = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const idBuf = Buffer.from(id, 'utf8');
  return Buffer.concat([MAGIC, Buffer.from([1, idBuf.length]), idBuf, iv, cipher.getAuthTag(), ct]);
}

export class DecryptError extends Error {
  readonly code: 'not_encrypted' | 'wrong_key' | 'tampered';
  constructor(code: 'not_encrypted' | 'wrong_key' | 'tampered', message: string) {
    super(message);
    this.code = code;
  }
}

export function decryptBlob(blob: Buffer, aad: string): Buffer {
  if (blob.length < 6 || !blob.subarray(0, 4).equals(MAGIC) || blob[4] !== 1)
    throw new DecryptError('not_encrypted', 'Not a DevHQ encrypted blob');
  const idLen = blob[5];
  const id = blob.subarray(6, 6 + idLen).toString('utf8');
  const { id: currentId, key } = loadKey();
  if (id !== currentId)
    throw new DecryptError('wrong_key', `Encrypted with key ${id}; current key is ${currentId}`);
  let o = 6 + idLen;
  const iv = blob.subarray(o, (o += 12));
  const tag = blob.subarray(o, (o += 16));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(blob.subarray(o)), decipher.final()]);
  } catch {
    throw new DecryptError(
      'tampered',
      'Authentication tag mismatch — blob altered or wrong context',
    );
  }
}
