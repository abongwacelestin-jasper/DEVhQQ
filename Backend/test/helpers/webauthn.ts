/**
 * A software authenticator for tests: real key pairs from node:crypto, real
 * authenticatorData (with attested credential data + COSE key for
 * registration), real clientDataJSON and real signatures, so the server-side
 * verifier is exercised exactly as a browser would exercise it.
 */

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_AT = 0x40;

export type Alg = -7 | -8 | -257;

export interface SoftAuthenticator {
  credentialId: string;
  algorithm: Alg;
  /** DER SubjectPublicKeyInfo, base64url — what the browser's getPublicKey() returns. */
  publicKey: string;
  publicKeyObject: KeyObject;
  privateKey: KeyObject;
  signCount: number;
}

export function createAuthenticator(algorithm: Alg = -7): SoftAuthenticator {
  const pair =
    algorithm === -7
      ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
      : algorithm === -8
        ? generateKeyPairSync('ed25519')
        : generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    credentialId: randomBytes(16).toString('base64url'),
    algorithm,
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    publicKeyObject: pair.publicKey,
    privateKey: pair.privateKey,
    signCount: 0,
  };
}

// ── Minimal CBOR encoder (ints, byte strings, maps) — enough for COSE_Key ──

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

type CborIn = number | Buffer | Map<number, CborIn>;

export function cbor(v: CborIn): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const parts: Buffer[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

/** COSE_Key for the authenticator's public key (RFC 9053). */
export function coseKey(
  auth: Pick<SoftAuthenticator, 'algorithm' | 'publicKeyObject'>,
  alg?: number,
) {
  const jwk = auth.publicKeyObject.export({ format: 'jwk' });
  const b = (s: string | undefined) => Buffer.from(s ?? '', 'base64url');
  const a = alg ?? auth.algorithm;
  if (auth.algorithm === -7)
    return cbor(
      new Map<number, CborIn>([
        [1, 2],
        [3, a],
        [-1, 1],
        [-2, b(jwk.x)],
        [-3, b(jwk.y)],
      ]),
    );
  if (auth.algorithm === -8)
    return cbor(
      new Map<number, CborIn>([
        [1, 1],
        [3, a],
        [-1, 6],
        [-2, b(jwk.x)],
      ]),
    );
  return cbor(
    new Map<number, CborIn>([
      [1, 3],
      [3, a],
      [-1, b(jwk.n)],
      [-2, b(jwk.e)],
    ]),
  );
}

export function authenticatorData(
  rpId: string,
  opts: {
    flags?: number;
    signCount?: number;
    rpIdHashOverride?: Buffer;
    /** Attested credential data (registration): credential id + COSE key. */
    attested?: { credentialId: Buffer; cose: Buffer };
  } = {},
): Buffer {
  const base = Buffer.alloc(37);
  (opts.rpIdHashOverride ?? createHash('sha256').update(rpId).digest()).copy(base, 0);
  base[32] = opts.flags ?? FLAG_UP | FLAG_UV | (opts.attested ? FLAG_AT : 0);
  base.writeUInt32BE(opts.signCount ?? 0, 33);
  if (!opts.attested) return base;
  const len = Buffer.alloc(2);
  len.writeUInt16BE(opts.attested.credentialId.length, 0);
  return Buffer.concat([
    base,
    Buffer.alloc(16) /* aaguid */,
    len,
    opts.attested.credentialId,
    opts.attested.cose,
  ]);
}

export function clientDataJSON(data: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(data), 'utf8');
}

export interface Ceremony {
  challengeId: string;
  challenge: string;
  rpId: string;
  origin: string;
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
  userHandle?: string;
}

/** Produces the body the browser posts to /api/auth/webauthn/verify. */
export function makeAssertion(
  auth: SoftAuthenticator,
  ceremony: Ceremony,
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
  // ES256 → DER ECDSA (node default), EdDSA → null digest, RS256 → PKCS#1 v1.5.
  const signature = sign(auth.algorithm === -8 ? null : 'sha256', signed, key);
  return {
    challengeId: ceremony.challengeId,
    credentialId: auth.credentialId,
    clientDataJSON: client.toString('base64url'),
    authenticatorData: authData.toString('base64url'),
    signature: signature.toString('base64url'),
    ...(o.userHandle === undefined ? {} : { userHandle: o.userHandle }),
  };
}

export interface RegistrationOverrides {
  type?: string;
  flags?: number;
  publicKey?: string;
  algorithm?: number;
  label?: string;
  /** Credential id embedded in authenticatorData (defaults to the reported one). */
  embeddedCredentialId?: Buffer;
  /** COSE key embedded in authenticatorData (defaults to the real key). */
  cose?: Buffer;
  origin?: string;
}

/** Produces the body the browser posts to /api/auth/passkeys (attestation "none"). */
export function makeRegistration(
  auth: SoftAuthenticator,
  ceremony: Ceremony,
  o: RegistrationOverrides = {},
) {
  const authData = authenticatorData(ceremony.rpId, {
    flags: o.flags,
    attested: {
      credentialId: o.embeddedCredentialId ?? Buffer.from(auth.credentialId, 'base64url'),
      cose: o.cose ?? coseKey(auth),
    },
  });
  return {
    challengeId: ceremony.challengeId,
    credentialId: auth.credentialId,
    clientDataJSON: clientDataJSON({
      type: o.type ?? 'webauthn.create',
      challenge: ceremony.challenge,
      origin: o.origin ?? ceremony.origin,
    }).toString('base64url'),
    authenticatorData: authData.toString('base64url'),
    publicKey: o.publicKey ?? auth.publicKey,
    algorithm: o.algorithm ?? auth.algorithm,
    label: o.label ?? 'Test key',
  };
}
