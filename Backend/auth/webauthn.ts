/**
 * WebAuthn / passkeys — phishing-resistant authentication.
 *
 * Passkeys are bound to our origin by the browser, so a look-alike phishing
 * site (however convincing, however AI-generated) can't obtain a usable
 * assertion. This module verifies registrations and assertions with
 * node:crypto only.
 *
 * Registration uses `attestation: "none"` and the browser-provided SPKI public
 * key (AuthenticatorAttestationResponse.getPublicKey()), which avoids a CBOR
 * dependency while still verifying origin, RP ID, user presence and user
 * verification.
 */

import { createHash, createPublicKey, verify as verifySig } from 'node:crypto';
import { config } from '../config/env.ts';
import { randomToken, safeEqual } from '../security/crypto.ts';
import { HttpError, type PasskeyCredential } from '../types.ts';

interface PendingChallenge {
  challenge: string;
  memberId?: string;
  kind: 'create' | 'get';
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 2 * 60_000;
const pending = new Map<string, PendingChallenge>();

/** Issues a single-use challenge. The returned id is echoed back by the client. */
export function issueChallenge(kind: 'create' | 'get', memberId?: string) {
  const id = randomToken(16);
  const challenge = randomToken(32);
  pending.set(id, { challenge, memberId, kind, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return {
    challengeId: id,
    publicKey: {
      challenge,
      rpId: config.rpId,
      rp: { id: config.rpId, name: config.rpName },
      timeout: CHALLENGE_TTL_MS,
      userVerification: 'required' as const,
      pubKeyCredParams: config.crypto.webauthnAlgorithms.map((alg) => ({
        type: 'public-key' as const,
        alg,
      })),
      attestation: 'none' as const,
    },
  };
}

function consumeChallenge(id: string, kind: 'create' | 'get'): PendingChallenge {
  const c = pending.get(id);
  pending.delete(id); // single use, even on failure
  if (!c || c.kind !== kind || c.expiresAt < Date.now())
    throw new HttpError(400, 'challenge_invalid', 'Challenge expired or unknown');
  return c;
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
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
  if (!safeEqual(data.challenge, challenge))
    throw new HttpError(400, 'client_data_invalid', 'Challenge mismatch');
  if (data.origin !== config.appOrigin)
    throw new HttpError(400, 'origin_mismatch', 'Origin mismatch');
  if (data.crossOrigin)
    throw new HttpError(400, 'origin_mismatch', 'Cross-origin ceremonies are not allowed');
  return raw;
}

/** Parses authenticatorData and enforces RP ID, user presence (UP) and user verification (UV). */
function checkAuthData(authenticatorData: string) {
  const buf = Buffer.from(authenticatorData, 'base64url');
  if (buf.length < 37) throw new HttpError(400, 'auth_data_invalid', 'authenticatorData too short');
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32];
  const signCount = buf.readUInt32BE(33);
  const expected = createHash('sha256').update(config.rpId).digest();
  if (!safeEqual(rpIdHash, expected)) throw new HttpError(400, 'rp_mismatch', 'RP ID mismatch');
  if (!(flags & 0x01)) throw new HttpError(400, 'user_not_present', 'User presence required');
  if (!(flags & 0x04)) throw new HttpError(400, 'user_not_verified', 'User verification required');
  return { buf, signCount };
}

export interface RegistrationInput {
  challengeId: string;
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  algorithm: number;
  label: string;
}

export function verifyRegistration(memberId: string, input: RegistrationInput): PasskeyCredential {
  const c = consumeChallenge(input.challengeId, 'create');
  if (c.memberId !== memberId)
    throw new HttpError(400, 'challenge_invalid', 'Challenge belongs to another member');
  checkClientData(input.clientDataJSON, 'webauthn.create', c.challenge);
  const { signCount } = checkAuthData(input.authenticatorData);
  if (!config.crypto.webauthnAlgorithms.includes(input.algorithm))
    throw new HttpError(400, 'alg_unsupported', 'Unsupported algorithm');
  // Ensure the key actually parses before storing it.
  createPublicKey({ key: Buffer.from(input.publicKey, 'base64url'), format: 'der', type: 'spki' });
  return {
    id: input.credentialId,
    publicKey: input.publicKey,
    algorithm: input.algorithm,
    signCount,
    createdAt: new Date().toISOString(),
    label: input.label,
  };
}

export interface AssertionInput {
  challengeId: string;
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/** Verifies an assertion and returns the new signature counter to persist. */
export function verifyAssertion(cred: PasskeyCredential, input: AssertionInput): number {
  const c = consumeChallenge(input.challengeId, 'get');
  const clientData = checkClientData(input.clientDataJSON, 'webauthn.get', c.challenge);
  const { buf, signCount } = checkAuthData(input.authenticatorData);

  // A counter that goes backwards suggests a cloned authenticator.
  if ((signCount !== 0 || cred.signCount !== 0) && signCount <= cred.signCount) {
    throw new HttpError(
      401,
      'counter_regressed',
      'Possible cloned authenticator — credential suspended',
    );
  }

  const signed = Buffer.concat([buf, createHash('sha256').update(clientData).digest()]);
  const key = createPublicKey({
    key: Buffer.from(cred.publicKey, 'base64url'),
    format: 'der',
    type: 'spki',
  });
  const sig = Buffer.from(input.signature, 'base64url');
  // ES256 signatures from WebAuthn are DER-encoded; RS256 is PKCS#1 v1.5.
  const ok =
    cred.algorithm === -7
      ? verifySig('sha256', signed, { key, dsaEncoding: 'der' }, sig)
      : verifySig('sha256', signed, key, sig);
  if (!ok) throw new HttpError(401, 'signature_invalid', 'Passkey signature invalid');
  return signCount;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, c] of pending) if (c.expiresAt < now) pending.delete(k);
}, 60_000).unref();
