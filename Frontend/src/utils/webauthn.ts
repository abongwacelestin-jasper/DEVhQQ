/**
 * WebAuthn ceremonies against the DevHQ API.
 *
 * The server issues every challenge (`/api/auth/webauthn/options`,
 * `/api/auth/passkeys/options`) and verifies every response
 * (`Backend/auth/webauthn.ts`). This module only translates between the
 * server's base64url JSON and the browser's ArrayBuffers — nothing is stored
 * in the browser, and nothing here decides whether a person is verified.
 */

import type { PasskeyRegistrationOptions, WebAuthnOptions } from '../api/types';

export function toB64Url(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s: string): ArrayBuffer {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function passkeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    !!window.PublicKeyCredential &&
    !!navigator.credentials
  );
}

/** Body for POST /api/auth/webauthn/verify. */
export interface AssertionPayload {
  challengeId: string;
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/** Body for POST /api/auth/passkeys. */
export interface RegistrationPayload {
  challengeId: string;
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  algorithm: number;
  label: string;
}

/** Asks an authenticator to sign the server's challenge (sign-in, step-up, unlock). */
export async function getAssertion(
  opts: WebAuthnOptions,
  signal?: AbortSignal,
): Promise<AssertionPayload> {
  if (!passkeySupported()) throw new Error('This browser does not support passkeys.');
  const pk = opts.publicKey;
  const cred = await navigator.credentials.get({
    signal,
    publicKey: {
      challenge: fromB64Url(pk.challenge),
      rpId: pk.rpId,
      timeout: pk.timeout,
      userVerification: pk.userVerification,
      allowCredentials: pk.allowCredentials?.map((c) => ({
        type: 'public-key' as const,
        id: fromB64Url(c.id),
      })),
    },
  });
  if (!(cred instanceof PublicKeyCredential)) throw new Error('No passkey was selected.');
  const res = cred.response as AuthenticatorAssertionResponse;
  return {
    challengeId: opts.challengeId,
    credentialId: toB64Url(cred.rawId),
    clientDataJSON: toB64Url(res.clientDataJSON),
    authenticatorData: toB64Url(res.authenticatorData),
    signature: toB64Url(res.signature),
  };
}

/** Creates a discoverable passkey bound to this origin for the signed-in member. */
export async function createCredential(
  opts: PasskeyRegistrationOptions,
  label: string,
): Promise<RegistrationPayload> {
  if (!passkeySupported()) throw new Error('This browser does not support passkeys.');
  const pk = opts.publicKey;
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64Url(pk.challenge),
      rp: pk.rp,
      user: {
        id: fromB64Url(opts.user.id),
        name: opts.user.name,
        displayName: opts.user.displayName,
      },
      pubKeyCredParams: pk.pubKeyCredParams,
      timeout: pk.timeout,
      attestation: pk.attestation,
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: opts.excludeCredentials.map((c) => ({
        type: 'public-key' as const,
        id: fromB64Url(c.id),
      })),
    },
  });
  if (!(cred instanceof PublicKeyCredential))
    throw new Error('Passkey registration was cancelled.');
  const res = cred.response as AuthenticatorAttestationResponse;
  // The server verifies with the SPKI key the browser extracts (no CBOR parsing server-side).
  if (
    typeof res.getPublicKey !== 'function' ||
    typeof res.getPublicKeyAlgorithm !== 'function' ||
    typeof res.getAuthenticatorData !== 'function'
  )
    throw new Error('This browser cannot export passkey details. Update it and try again.');
  const publicKey = res.getPublicKey();
  if (!publicKey) throw new Error('This authenticator uses an algorithm DevHQ does not accept.');
  return {
    challengeId: opts.challengeId,
    credentialId: toB64Url(cred.rawId),
    clientDataJSON: toB64Url(res.clientDataJSON),
    authenticatorData: toB64Url(res.getAuthenticatorData()),
    publicKey: toB64Url(publicKey),
    algorithm: res.getPublicKeyAlgorithm(),
    label: label.slice(0, 60),
  };
}

/** A readable label for a new passkey, without fingerprinting detail. */
export function defaultPasskeyLabel(): string {
  const ua = navigator.userAgent;
  const os = /Mac/.test(ua)
    ? 'Mac'
    : /iPhone|iPad/.test(ua)
      ? 'iOS device'
      : /Android/.test(ua)
        ? 'Android device'
        : /Windows/.test(ua)
          ? 'Windows PC'
          : /Linux/.test(ua)
            ? 'Linux device'
            : 'This device';
  return `${os} passkey`;
}

export function describeWebAuthnError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError')
      return 'The request was cancelled or timed out. Passkeys can’t be used inside embedded previews — open the app in its own tab.';
    if (e.name === 'InvalidStateError') return 'A passkey for this device is already registered.';
    if (e.name === 'SecurityError') return 'Passkeys need a secure origin that matches DevHQ.';
    if (e.name === 'AbortError') return 'The passkey request was cancelled.';
  }
  return e instanceof Error ? e.message : 'Passkey request failed.';
}
