import type { StoredPasskey } from '../types/securityFramework';

const STORAGE_KEY = 'devhq.passkeys.v1';

function toB64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): ArrayBuffer {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Returns a fresh challenge buffer (WebAuthn's BufferSource wants an ArrayBuffer). */
function randomChallenge(): ArrayBuffer {
  // In production the challenge comes from POST /api/auth/webauthn/options (Backend/auth/webauthn.ts).
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

export function listPasskeys(): StoredPasskey[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as StoredPasskey[];
  } catch {
    return [];
  }
}

function savePasskeys(list: StoredPasskey[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/** Registers a platform passkey for the signed-in member. Throws with a readable message on failure. */
export async function registerPasskey(user: {
  id: string;
  name: string;
  email: string;
}): Promise<StoredPasskey> {
  if (!passkeySupported()) throw new Error('This browser does not support passkeys.');
  const existing = listPasskeys();
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'DevHQ', id: window.location.hostname },
      user: { id: new TextEncoder().encode(user.id), name: user.email, displayName: user.name },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      attestation: 'none',
      timeout: 60_000,
      excludeCredentials: existing.map((p) => ({
        type: 'public-key' as const,
        id: fromB64Url(p.id),
      })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Passkey registration was cancelled.');
  const response = cred.response as AuthenticatorAttestationResponse;
  const pk = typeof response.getPublicKey === 'function' ? response.getPublicKey() : null;
  const alg =
    typeof response.getPublicKeyAlgorithm === 'function'
      ? response.getPublicKeyAlgorithm()
      : undefined;
  const entry: StoredPasskey = {
    id: cred.id,
    label: `${navigator.platform || 'This device'} passkey`,
    createdAt: new Date().toISOString(),
    publicKey: pk ? toB64Url(pk) : undefined,
    algorithm: alg,
  };
  savePasskeys([...existing, entry]);
  return entry;
}

/** Asks the authenticator to prove possession of a registered passkey (user verification required). */
export async function verifyPasskey(): Promise<boolean> {
  if (!passkeySupported()) return false;
  const existing = listPasskeys();
  if (!existing.length) return false;
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      rpId: window.location.hostname,
      allowCredentials: existing.map((p) => ({
        type: 'public-key' as const,
        id: fromB64Url(p.id),
      })),
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  return !!assertion;
}

export function removePasskey(id: string) {
  savePasskeys(listPasskeys().filter((p) => p.id !== id));
}

export function describeWebAuthnError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError')
      return 'The request was cancelled or blocked. Passkeys can’t be created inside embedded previews — open the app in its own tab.';
    if (e.name === 'InvalidStateError') return 'A passkey for this device is already registered.';
    if (e.name === 'SecurityError') return 'Passkeys need a secure (HTTPS) origin.';
  }
  return e instanceof Error ? e.message : 'Passkey request failed.';
}
