/**
 * Encryption at rest for integration credentials, webhook signing secrets and
 * cached GitHub installation tokens.
 *
 * The SEC lane is adding `seal`/`open` to `security/crypto.ts`. They were not
 * on this branch when B-DOMAIN was cut, so this module defines the narrow
 * interface every engineering module uses (`SecretSealer`) and a local
 * AES-256-GCM implementation keyed by `DATA_ENCRYPTION_KEY` (WAVE4 §4). When
 * SEC lands, the coordinator can swap `sealer` for theirs with `setSealer()`
 * — callers never change.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url parts, 96-bit random IV).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../../config/env.ts';
import { HttpError } from '../../types.ts';

export interface SecretSealer {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

function key(): Buffer {
  const hex = process.env.DATA_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  if (config.isProd)
    throw new HttpError(
      503,
      'integration_unconfigured',
      'DATA_ENCRYPTION_KEY (32-byte hex) is required to store integration secrets',
    );
  // Development only: derive a stable key so local restarts can still open sealed rows.
  return createHash('sha256').update(`devhq-eng-seal:${config.sessionSecret}`).digest();
}

const aesGcmSealer: SecretSealer = {
  seal(plaintext) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  },
  open(sealed) {
    const [v, iv, tag, ct] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || ct === undefined)
      throw new HttpError(500, 'sealed_format', 'Stored secret has an unknown format');
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  },
};

let sealer: SecretSealer = aesGcmSealer;

export function setSealer(next: SecretSealer) {
  sealer = next;
}

export const seal = (plaintext: string) => sealer.seal(plaintext);
export const open = (sealed: string) => sealer.open(sealed);

/** `••••abcd` — what the UI may show for a stored secret. */
export function hint(secret: string): string {
  return `••••${secret.slice(-4)}`;
}
