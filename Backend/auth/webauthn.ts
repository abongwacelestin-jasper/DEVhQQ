/**
 * WebAuthn / passkeys — phishing-resistant authentication (node:crypto only).
 *
 * Passkeys are bound to our origin by the browser, so a look-alike phishing
 * site (however convincing, however AI-generated) can't obtain a usable
 * assertion.
 *
 * Ceremonies and what is enforced (W3C WebAuthn L2 §7.1 / §7.2):
 *
 *  - Challenges: 32 random bytes, single use (deleted on first lookup, even on
 *    failure), 2-minute expiry, bound to a purpose and — for anything but
 *    passwordless sign-in — to the member *and* the session that asked for it.
 *  - clientDataJSON: `type`, `challenge` (constant-time), `origin` in the
 *    configured allow-list (`config.webauthnOrigins`), `crossOrigin` false.
 *  - authenticatorData: `rpIdHash` = SHA-256(rpId), UP and UV flags set;
 *    registration also needs AT and the embedded credential id must equal the
 *    one the client reports.
 *  - Registration (`attestation: "none"`): the browser-supplied SPKI
 *    (`getPublicKey()`) must match the COSE key inside authenticatorData
 *    (parsed with a minimal CBOR reader), and its algorithm must be allowed by
 *    `config.crypto.webauthnAlgorithms`.
 *  - Assertion: signature over `authenticatorData || SHA-256(clientDataJSON)`
 *    — ES256 (ASN.1 DER ECDSA on P-256), EdDSA (Ed25519) or RS256 (PKCS#1
 *    v1.5) — verified *before* the counter check, so garbage cannot suspend a
 *    credential. The algorithm must still be allowed at use time.
 *  - Sign-count regression (either counter non-zero and new ≤ stored) marks
 *    the credential suspended: a likely cloned authenticator.
 */

import { createHash, createPublicKey, verify as verifySig, type KeyObject } from 'node:crypto';
import { config } from '../config/env.ts';
import { randomToken, safeEqual } from '../security/crypto.ts';
import { HttpError, type PasskeyCredential } from '../types.ts';

/**
 * `register` — add a passkey to a signed-in account.
 * `sign-in`  — passwordless sign-in with a discoverable credential.
 * `mfa`      — second factor after the password step (partial session).
 * `step-up`  — re-verification for sensitive actions and lock-screen unlock.
 */
export type CeremonyPurpose = 'register' | 'sign-in' | 'mfa' | 'step-up';

export interface PendingChallenge {
  challenge: string;
  purpose: CeremonyPurpose;
  memberId?: string;
  sessionId?: string;
  expiresAt: number;
}

/** Extra fields we persist on a passkey beyond the shared PasskeyCredential shape. */
export interface StoredPasskey extends PasskeyCredential {
  transports?: string[];
  lastUsedAt?: string;
  /** Set when a sign-count regression was detected; the credential is refused until removed. */
  suspendedAt?: string;
}

export const CHALLENGE_TTL_MS = 2 * 60_000;
const MAX_PENDING = 10_000;
const pending = new Map<string, PendingChallenge>();

const COSE_ES256 = -7;
const COSE_EDDSA = -8;
const COSE_RS256 = -257;

function remember(c: PendingChallenge): string {
  if (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  const id = randomToken(16);
  pending.set(id, c);
  return id;
}

export function isSuspended(c: PasskeyCredential): boolean {
  return 'suspendedAt' in c && typeof c.suspendedAt === 'string';
}

function transportsOf(c: PasskeyCredential): string[] | undefined {
  return 'transports' in c && Array.isArray(c.transports)
    ? c.transports.filter((t): t is string => typeof t === 'string')
    : undefined;
}

function descriptor(c: PasskeyCredential) {
  const transports = transportsOf(c);
  return { type: 'public-key' as const, id: c.id, ...(transports ? { transports } : {}) };
}

/** PublicKeyCredentialCreationOptions (JSON form) for `navigator.credentials.create`. */
export function issueRegistrationChallenge(
  member: { id: string; email: string; name: string; passkeys: PasskeyCredential[] },
  sessionId: string,
) {
  const challenge = randomToken(32);
  const challengeId = remember({
    challenge,
    purpose: 'register',
    memberId: member.id,
    sessionId,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return {
    challengeId,
    purpose: 'register' as const,
    publicKey: {
      challenge,
      rp: { id: config.rpId, name: config.rpName },
      user: {
        id: Buffer.from(member.id).toString('base64url'),
        name: member.email,
        displayName: member.name,
      },
      pubKeyCredParams: config.crypto.webauthnAlgorithms.map((alg) => ({
        type: 'public-key' as const,
        alg,
      })),
      timeout: CHALLENGE_TTL_MS,
      attestation: 'none' as const,
      authenticatorSelection: {
        residentKey: 'preferred' as const,
        requireResidentKey: false,
        userVerification: 'required' as const,
      },
      excludeCredentials: member.passkeys.map(descriptor),
    },
  };
}

/**
 * PublicKeyCredentialRequestOptions (JSON form) for `navigator.credentials.get`.
 * Passwordless sign-in sends no allowCredentials (discoverable credentials),
 * so the endpoint never reveals which accounts have passkeys.
 */
export function issueAssertionChallenge(
  purpose: Exclude<CeremonyPurpose, 'register'>,
  member?: { id: string; passkeys: PasskeyCredential[] },
  sessionId?: string,
) {
  if (purpose !== 'sign-in' && (!member || !sessionId))
    throw new HttpError(401, 'unauthenticated', 'Sign in required');
  const challenge = randomToken(32);
  const challengeId = remember({
    challenge,
    purpose,
    memberId: purpose === 'sign-in' ? undefined : member!.id,
    sessionId: purpose === 'sign-in' ? undefined : sessionId,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return {
    challengeId,
    purpose,
    publicKey: {
      challenge,
      rpId: config.rpId,
      timeout: CHALLENGE_TTL_MS,
      userVerification: 'required' as const,
      allowCredentials:
        purpose === 'sign-in'
          ? []
          : member!.passkeys.filter((c) => !isSuspended(c)).map(descriptor),
    },
  };
}

/** Removes and returns a challenge. Single use: it is gone even if verification later fails. */
export function takeChallenge(id: string, kind: 'create' | 'get'): PendingChallenge {
  const c = pending.get(id);
  pending.delete(id);
  const wantCreate = kind === 'create';
  if (!c || (c.purpose === 'register') !== wantCreate || c.expiresAt < Date.now())
    throw new HttpError(400, 'challenge_invalid', 'Challenge expired or unknown');
  return c;
}

interface ClientData {
  type?: unknown;
  challenge?: unknown;
  origin?: unknown;
  crossOrigin?: unknown;
}

function checkClientData(clientDataJSON: string, expectedType: string, challenge: string): Buffer {
  const raw = Buffer.from(clientDataJSON, 'base64url');
  let data: ClientData;
  try {
    data = JSON.parse(raw.toString('utf8')) as ClientData;
  } catch {
    throw new HttpError(400, 'client_data_invalid', 'Malformed clientDataJSON');
  }
  if (data.type !== expectedType)
    throw new HttpError(400, 'client_data_invalid', 'Unexpected ceremony type');
  if (typeof data.challenge !== 'string' || !safeEqual(data.challenge, challenge))
    throw new HttpError(400, 'client_data_invalid', 'Challenge mismatch');
  if (typeof data.origin !== 'string' || !config.webauthnOrigins.includes(data.origin))
    throw new HttpError(400, 'origin_mismatch', 'Origin mismatch');
  if (data.crossOrigin === true)
    throw new HttpError(400, 'origin_mismatch', 'Cross-origin ceremonies are not allowed');
  return raw;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

/** Parses authenticatorData and enforces RP ID, user presence (UP) and user verification (UV). */
function checkAuthData(authenticatorData: string) {
  const buf = Buffer.from(authenticatorData, 'base64url');
  if (buf.length < 37) throw new HttpError(400, 'auth_data_invalid', 'authenticatorData too short');
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32];
  const signCount = buf.readUInt32BE(33);
  const expected = createHash('sha256').update(config.rpId).digest();
  if (!safeEqual(rpIdHash, expected)) throw new HttpError(400, 'rp_mismatch', 'RP ID mismatch');
  if (!(flags & FLAG_UP)) throw new HttpError(400, 'user_not_present', 'User presence required');
  if (!(flags & FLAG_UV))
    throw new HttpError(400, 'user_not_verified', 'User verification required');
  return { buf, flags, signCount };
}

// ---------------------------------------------------------------------------
// Minimal CBOR (RFC 8949) reader — enough for COSE_Key maps. Definite lengths
// only, depth- and size-bounded; anything else is rejected.
// ---------------------------------------------------------------------------

type Cbor = number | string | boolean | null | Buffer | Cbor[] | Map<number | string, Cbor>;

function cborBad(): HttpError {
  return new HttpError(400, 'auth_data_invalid', 'Malformed credential public key');
}

function readCbor(buf: Buffer, start: number, depth = 0): { value: Cbor; end: number } {
  if (depth > 8 || start >= buf.length) throw cborBad();
  const initial = buf[start];
  const major = initial >> 5;
  const info = initial & 0x1f;
  let pos = start + 1;
  let arg: number;
  if (info < 24) arg = info;
  else if (info === 24) {
    if (pos + 1 > buf.length) throw cborBad();
    arg = buf.readUInt8(pos);
    pos += 1;
  } else if (info === 25) {
    if (pos + 2 > buf.length) throw cborBad();
    arg = buf.readUInt16BE(pos);
    pos += 2;
  } else if (info === 26) {
    if (pos + 4 > buf.length) throw cborBad();
    arg = buf.readUInt32BE(pos);
    pos += 4;
  } else throw cborBad(); // 64-bit lengths and indefinite lengths are never needed here
  switch (major) {
    case 0:
      return { value: arg, end: pos };
    case 1:
      return { value: -1 - arg, end: pos };
    case 2:
    case 3: {
      if (pos + arg > buf.length) throw cborBad();
      const bytes = buf.subarray(pos, pos + arg);
      return { value: major === 2 ? Buffer.from(bytes) : bytes.toString('utf8'), end: pos + arg };
    }
    case 4: {
      if (arg > 64) throw cborBad();
      const out: Cbor[] = [];
      for (let i = 0; i < arg; i++) {
        const r = readCbor(buf, pos, depth + 1);
        out.push(r.value);
        pos = r.end;
      }
      return { value: out, end: pos };
    }
    case 5: {
      if (arg > 64) throw cborBad();
      const out = new Map<number | string, Cbor>();
      for (let i = 0; i < arg; i++) {
        const k = readCbor(buf, pos, depth + 1);
        if (typeof k.value !== 'number' && typeof k.value !== 'string') throw cborBad();
        const val = readCbor(buf, k.end, depth + 1);
        out.set(k.value, val.value);
        pos = val.end;
      }
      return { value: out, end: pos };
    }
    case 7:
      if (info === 20) return { value: false, end: pos };
      if (info === 21) return { value: true, end: pos };
      if (info === 22) return { value: null, end: pos };
      throw cborBad();
    default:
      throw cborBad(); // tags (6) are not valid in COSE_Key
  }
}

function coseBytes(key: Map<number | string, Cbor>, label: number): Buffer {
  const v = key.get(label);
  if (!Buffer.isBuffer(v)) throw cborBad();
  return v;
}

/** Strips leading zero bytes so JWK and COSE big-integers compare equal. */
function trimInt(b: Buffer): Buffer {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  return b.subarray(i);
}

/** Confirms the COSE key in authenticatorData is the same key as the SPKI the client sent. */
function assertSameKey(cose: Map<number | string, Cbor>, spki: KeyObject, algorithm: number) {
  const alg = cose.get(3);
  if (alg !== algorithm)
    throw new HttpError(400, 'alg_mismatch', 'Credential algorithm does not match its key');
  const jwk = spki.export({ format: 'jwk' });
  const eq = (a: Buffer, b: string | undefined) =>
    b !== undefined && safeEqual(trimInt(a), trimInt(Buffer.from(b, 'base64url')));
  const kty = cose.get(1);
  let same = false;
  if (algorithm === COSE_ES256)
    same =
      kty === 2 &&
      cose.get(-1) === 1 &&
      jwk.kty === 'EC' &&
      jwk.crv === 'P-256' &&
      eq(coseBytes(cose, -2), jwk.x) &&
      eq(coseBytes(cose, -3), jwk.y);
  else if (algorithm === COSE_EDDSA)
    same =
      kty === 1 &&
      cose.get(-1) === 6 &&
      jwk.kty === 'OKP' &&
      jwk.crv === 'Ed25519' &&
      eq(coseBytes(cose, -2), jwk.x);
  else if (algorithm === COSE_RS256)
    same =
      kty === 3 &&
      jwk.kty === 'RSA' &&
      eq(coseBytes(cose, -1), jwk.n) &&
      eq(coseBytes(cose, -2), jwk.e);
  if (!same)
    throw new HttpError(400, 'key_mismatch', 'Public key does not match authenticator data');
}

/** Rejects keys whose type does not fit the declared algorithm (e.g. an RSA key claiming ES256). */
function assertKeyFitsAlg(key: KeyObject, algorithm: number) {
  const t = key.asymmetricKeyType;
  const ok =
    (algorithm === COSE_ES256 &&
      t === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1') ||
    (algorithm === COSE_EDDSA && t === 'ed25519') ||
    (algorithm === COSE_RS256 &&
      t === 'rsa' &&
      (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048);
  if (!ok) throw new HttpError(400, 'alg_unsupported', 'Key type does not match algorithm');
}

function assertAlgAllowed(algorithm: number) {
  if (!config.crypto.webauthnAlgorithms.includes(algorithm))
    throw new HttpError(400, 'alg_unsupported', 'Unsupported algorithm');
}

function spkiOf(b64: string): KeyObject {
  try {
    return createPublicKey({ key: Buffer.from(b64, 'base64url'), format: 'der', type: 'spki' });
  } catch {
    throw new HttpError(400, 'key_invalid', 'Public key is not a valid SPKI structure');
  }
}

export interface RegistrationInput {
  challengeId: string;
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  algorithm: number;
  label: string;
  transports?: string[];
}

export function verifyRegistration(
  memberId: string,
  sessionId: string,
  input: RegistrationInput,
): StoredPasskey {
  const c = takeChallenge(input.challengeId, 'create');
  if (c.memberId !== memberId || c.sessionId !== sessionId)
    throw new HttpError(400, 'challenge_invalid', 'Challenge was issued to another session');
  checkClientData(input.clientDataJSON, 'webauthn.create', c.challenge);
  const { buf, flags, signCount } = checkAuthData(input.authenticatorData);
  assertAlgAllowed(input.algorithm);

  // Attested credential data: aaguid(16) | credIdLen(2) | credId | COSE_Key
  if (!(flags & FLAG_AT) || buf.length < 55)
    throw new HttpError(400, 'auth_data_invalid', 'Attested credential data missing');
  const idLen = buf.readUInt16BE(53);
  if (idLen < 16 || idLen > 1023 || 55 + idLen > buf.length)
    throw new HttpError(400, 'auth_data_invalid', 'Credential id length invalid');
  const credId = buf.subarray(55, 55 + idLen);
  if (!safeEqual(credId, Buffer.from(input.credentialId, 'base64url')))
    throw new HttpError(
      400,
      'credential_mismatch',
      'Credential id does not match authenticator data',
    );
  const { value: cose } = readCbor(buf, 55 + idLen);
  if (!(cose instanceof Map)) throw cborBad();

  const key = spkiOf(input.publicKey);
  assertKeyFitsAlg(key, input.algorithm);
  assertSameKey(cose, key, input.algorithm);

  return {
    id: input.credentialId,
    publicKey: input.publicKey,
    algorithm: input.algorithm,
    signCount,
    createdAt: new Date().toISOString(),
    label: input.label,
    ...(input.transports?.length ? { transports: input.transports } : {}),
  };
}

export interface AssertionInput {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string;
}

export type AssertionResult =
  { ok: true; signCount: number } | { ok: false; reason: 'counter_regressed'; signCount: number };

/**
 * Verifies an assertion against a stored credential for a challenge already
 * taken with `takeChallenge(id, 'get')`. Throws on any failure except a
 * sign-count regression, which is returned so the caller can suspend the
 * credential and audit it before refusing.
 */
export function verifyAssertion(
  cred: PasskeyCredential,
  ownerId: string,
  challenge: PendingChallenge,
  input: AssertionInput,
): AssertionResult {
  if (challenge.memberId && challenge.memberId !== ownerId)
    throw new HttpError(401, 'invalid_credentials', 'Passkey belongs to another account');
  if (isSuspended(cred))
    throw new HttpError(
      401,
      'credential_suspended',
      'This passkey is suspended — remove it and register again',
    );
  if (input.userHandle !== undefined && input.userHandle !== '') {
    if (!safeEqual(input.userHandle, Buffer.from(ownerId).toString('base64url')))
      throw new HttpError(401, 'invalid_credentials', 'Passkey user handle mismatch');
  }
  const clientData = checkClientData(input.clientDataJSON, 'webauthn.get', challenge.challenge);
  const { buf, signCount } = checkAuthData(input.authenticatorData);
  assertAlgAllowed(cred.algorithm);

  const signed = Buffer.concat([buf, createHash('sha256').update(clientData).digest()]);
  const key = spkiOf(cred.publicKey);
  assertKeyFitsAlg(key, cred.algorithm);
  const sig = Buffer.from(input.signature, 'base64url');
  let ok = false;
  try {
    if (cred.algorithm === COSE_ES256)
      ok = verifySig('sha256', signed, { key, dsaEncoding: 'der' }, sig);
    else if (cred.algorithm === COSE_EDDSA) ok = verifySig(null, signed, key, sig);
    else if (cred.algorithm === COSE_RS256) ok = verifySig('sha256', signed, key, sig);
  } catch {
    ok = false; // malformed DER and similar parse failures are just invalid signatures
  }
  if (!ok) throw new HttpError(401, 'signature_invalid', 'Passkey signature invalid');

  // Checked only after the signature: an unsigned request must never be able to suspend a key.
  if ((signCount !== 0 || cred.signCount !== 0) && signCount <= cred.signCount)
    return { ok: false, reason: 'counter_regressed', signCount };
  return { ok: true, signCount };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, c] of pending) if (c.expiresAt < now) pending.delete(k);
}, 60_000).unref();
