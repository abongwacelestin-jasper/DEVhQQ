/**
 * A software authenticator for tests: real key pairs from node:crypto, real
 * authenticatorData / clientDataJSON encoding and real signatures, so the
 * server-side verifier is exercised exactly as a browser would exercise it.
 */

import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;

export interface SoftAuthenticator {
  credentialId: string;
  algorithm: -7 | -257;
  /** DER SubjectPublicKeyInfo, base64url — what the browser's getPublicKey() returns. */
  publicKey: string;
  privateKey: KeyObject;
  signCount: number;
}

export function createAuthenticator(algorithm: -7 | -257 = -7): SoftAuthenticator {
  const pair =
    algorithm === -7
      ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
      : generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    credentialId: createHash('sha256')
      .update(String(Math.random()) + String(process.hrtime.bigint()))
      .digest('base64url')
      .slice(0, 22),
    algorithm,
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: pair.privateKey,
    signCount: 0,
  };
}

export function authenticatorData(
  rpId: string,
  opts: { flags?: number; signCount?: number; rpIdHashOverride?: Buffer } = {},
): Buffer {
  const buf = Buffer.alloc(37);
  (opts.rpIdHashOverride ?? createHash('sha256').update(rpId).digest()).copy(buf, 0);
  buf[32] = opts.flags ?? FLAG_UP | FLAG_UV;
  buf.writeUInt32BE(opts.signCount ?? 0, 33);
  return buf;
}

export function clientDataJSON(data: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(data), 'utf8');
}

export interface AssertionOverrides {
  type?: string;
  origin?: string;
  challenge?: string;
  crossOrigin?: boolean;
  flags?: number;
  signCount?: number;
  rpIdHashOverride?: Buffer;
  /** Sign with a different key (e.g. an attacker's). */
  signWith?: KeyObject;
}

/** Produces the body the browser posts to /api/auth/webauthn/verify. */
export function makeAssertion(
  auth: SoftAuthenticator,
  ceremony: { challengeId: string; challenge: string; rpId: string; origin: string },
  o: AssertionOverrides = {},
) {
  const signCount = o.signCount ?? auth.signCount + 1;
  const authData = authenticatorData(ceremony.rpId, {
    flags: o.flags,
    signCount,
    rpIdHashOverride: o.rpIdHashOverride,
  });
  const client = clientDataJSON({
    type: o.type ?? 'webauthn.get',
    challenge: o.challenge ?? ceremony.challenge,
    origin: o.origin ?? ceremony.origin,
    ...(o.crossOrigin === undefined ? {} : { crossOrigin: o.crossOrigin }),
  });
  const signed = Buffer.concat([authData, createHash('sha256').update(client).digest()]);
  const key = o.signWith ?? auth.privateKey;
  // ES256 → DER-encoded ECDSA (node's default), RS256 → PKCS#1 v1.5.
  const signature = sign('sha256', signed, key);
  return {
    challengeId: ceremony.challengeId,
    credentialId: auth.credentialId,
    clientDataJSON: client.toString('base64url'),
    authenticatorData: authData.toString('base64url'),
    signature: signature.toString('base64url'),
  };
}

/** Produces the body the browser posts to /api/auth/passkeys (attestation "none"). */
export function makeRegistration(
  auth: SoftAuthenticator,
  ceremony: { challengeId: string; challenge: string; rpId: string; origin: string },
  o: { type?: string; flags?: number; publicKey?: string; algorithm?: number; label?: string } = {},
) {
  return {
    challengeId: ceremony.challengeId,
    credentialId: auth.credentialId,
    clientDataJSON: clientDataJSON({
      type: o.type ?? 'webauthn.create',
      challenge: ceremony.challenge,
      origin: ceremony.origin,
    }).toString('base64url'),
    authenticatorData: authenticatorData(ceremony.rpId, { flags: o.flags }).toString('base64url'),
    publicKey: o.publicKey ?? auth.publicKey,
    algorithm: o.algorithm ?? auth.algorithm,
    label: o.label ?? 'Test key',
  };
}
