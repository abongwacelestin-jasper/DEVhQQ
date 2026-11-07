/**
 * Typed calls for identity, onboarding, recovery and credentials.
 *
 * Auth calls are `silent`: their 401s are answers (wrong code, signed out),
 * not events that should end the session or open re-verification.
 * Endpoints still being built by the backend lanes (WAVE4 §6) surface as
 * `ApiError#isUnavailable`, which callers turn into an honest "not available"
 * state instead of a fake success.
 */

import { api, ApiError } from '../client';
import type {
  ApiAccessToken,
  ApiPasskey,
  ApiSessionView,
  ApiSignIn,
  AuthenticatedResponse,
  CreatedAccessToken,
  DemoAccountsResponse,
  OnboardingProfile,
  OnboardingState,
  PasskeyRegistrationOptions,
  PendingResponse,
  SessionResponse,
  SignInResponse,
  StepUpResponse,
  TotpEnrollment,
  WebAuthnOptions,
} from '../types';
import { createCredential, getAssertion } from '../../utils/webauthn';

const silent = { silent: true } as const;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const getSession = () => api<SessionResponse>('/api/auth/session', silent);
export const getPending = () => api<PendingResponse>('/api/auth/pending', silent);

export const signInWithPassword = (email: string, password: string) =>
  api<SignInResponse>('/api/auth/sign-in', {
    method: 'POST',
    body: { email, password },
    ...silent,
  });

export const signInDemoRole = (role: string) =>
  api<AuthenticatedResponse>('/api/auth/demo', { method: 'POST', body: { role }, ...silent });

export const verifyTotp = (code: string) =>
  api<AuthenticatedResponse>('/api/auth/mfa/totp', { method: 'POST', body: { code }, ...silent });

/** A one-time backup code as the second factor; burnt on success. */
export const verifyBackupCode = (code: string) =>
  api<AuthenticatedResponse & { backupCodesRemaining?: number }>('/api/auth/mfa/backup', {
    method: 'POST',
    body: { code },
    ...silent,
  });

export const stepUpTotp = (code: string) =>
  api<StepUpResponse>('/api/auth/step-up', { method: 'POST', body: { code }, ...silent });

export const signOutHere = () => api<void>('/api/auth/sign-out', { method: 'POST', ...silent });

export const signOutEverywhere = () =>
  api<{ revoked: number }>('/api/auth/sign-out-everywhere', { method: 'POST', ...silent });

export const revokeSessionByPrefix = (prefix: string) =>
  api<void>(`/api/auth/sessions/${encodeURIComponent(prefix)}`, { method: 'DELETE' });

/** Admins see every live session; everyone else sees their own. */
export const listLiveSessions = () => api<ApiSessionView[]>('/api/locations/sessions');

export const listSignIns = (limit = 50) =>
  api<ApiSignIn[]>(`/api/locations/sign-ins?limit=${limit}`);

/**
 * Asks the server to require re-verification for this session (server-side
 * lock). Not every backend build has it yet; the client lock still applies.
 */
export async function lockOnServer(): Promise<boolean> {
  try {
    await api<void>('/api/auth/lock', { method: 'POST', ...silent });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.isUnavailable) return false;
    throw e;
  }
}

/** Demo hints come only from the server, and only when it says demo mode is on. */
export async function getDemoAccounts(): Promise<DemoAccountsResponse> {
  try {
    const r = await api<DemoAccountsResponse>('/api/auth/demo-accounts', silent);
    return r?.enabled ? r : { enabled: false, accounts: [] };
  } catch {
    return { enabled: false, accounts: [] };
  }
}

// ---------------------------------------------------------------------------
// Passkeys (WebAuthn)
// ---------------------------------------------------------------------------

/**
 * One passkey ceremony: server challenge → authenticator → server verify.
 * Signs in when there is no session, completes MFA for a password-only
 * session, and re-verifies (step-up / unlock) a verified one.
 */
export async function passkeyCeremony(signal?: AbortSignal): Promise<void> {
  const options = await api<WebAuthnOptions>('/api/auth/webauthn/options', {
    method: 'POST',
    body: {},
    ...silent,
  });
  const assertion = await getAssertion(options, signal);
  await api<{ ok: boolean }>('/api/auth/webauthn/verify', {
    method: 'POST',
    body: assertion,
    ...silent,
  });
}

export async function registerPasskey(label: string): Promise<ApiPasskey> {
  const options = await api<PasskeyRegistrationOptions>('/api/auth/passkeys/options', {
    method: 'POST',
    body: {},
  });
  const payload = await createCredential(options, label);
  return api<ApiPasskey>('/api/auth/passkeys', { method: 'POST', body: payload });
}

/** `null` when the server has no listing endpoint yet (only the count is known then). */
export async function listPasskeys(): Promise<ApiPasskey[] | null> {
  try {
    const r = await api<ApiPasskey[] | { items: ApiPasskey[] }>('/api/auth/passkeys');
    return Array.isArray(r) ? r : (r?.items ?? []);
  } catch (e) {
    if (e instanceof ApiError && (e.isUnavailable || e.status === 405)) return null;
    throw e;
  }
}

export const removePasskey = (id: string) =>
  api<void>(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// TOTP enrollment
// ---------------------------------------------------------------------------

function toEnrollment(r: Record<string, unknown>): TotpEnrollment {
  const uri = [r.otpauthUri, r.otpauthUrl, r.uri].find(
    (v): v is string => typeof v === 'string' && v.startsWith('otpauth://'),
  );
  if (!uri) throw new ApiError(502, 'bad_response', 'The server did not return an enrollment URI.');
  const secret =
    typeof r.secret === 'string' ? r.secret : (new URL(uri).searchParams.get('secret') ?? '');
  return {
    otpauthUri: uri,
    secret,
    expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : undefined,
  };
}

/** Adds or replaces the authenticator of a signed-in member (Security page; step-up applies). */
export async function enrollTotp(): Promise<TotpEnrollment> {
  return toEnrollment(
    await api<Record<string, unknown>>('/api/auth/totp/enroll', { method: 'POST', body: {} }),
  );
}

export const confirmTotp = (code: string) =>
  api<{ ok: boolean }>('/api/auth/totp/confirm', { method: 'POST', body: { code } });

/**
 * First-factor enrollment during sign-in, for a password-only session whose
 * member has no second factor yet. Confirming rotates the cookie to a verified session.
 */
export async function beginSignInEnrollment(): Promise<TotpEnrollment> {
  return toEnrollment(
    await api<Record<string, unknown>>('/api/auth/mfa/enroll', {
      method: 'POST',
      body: {},
      ...silent,
    }),
  );
}

export const confirmSignInEnrollment = (code: string) =>
  api<AuthenticatedResponse>('/api/auth/mfa/enroll/confirm', {
    method: 'POST',
    body: { code },
    ...silent,
  });

// ---------------------------------------------------------------------------
// Onboarding (server-authoritative NDA + profile stages)
// ---------------------------------------------------------------------------

/**
 * `null` means this backend has no onboarding module: the server enforces no
 * NDA/profile stage, so the client must not invent one.
 */
export async function getOnboarding(): Promise<OnboardingState | null> {
  try {
    return normalizeOnboarding(await api<unknown>('/api/onboarding', silent));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code !== 'onboarding_required') return null;
    throw e;
  }
}

/** Volunteer commitment recorded with the NDA signature (`Backend/routes/onboarding.routes.ts`). */
export interface NdaCommitment {
  hours: number;
  days: string[];
  duration: string;
  areas: string[];
  start?: string;
}

export async function signNdaOnServer(
  version: string,
  signedName: string,
  commitment?: NdaCommitment,
) {
  const r = await api<unknown>('/api/onboarding/nda', {
    method: 'POST',
    body: { version, signedName, ...(commitment ? { commitment } : {}) },
    ...silent,
  });
  return normalizeOnboarding(r) ?? (await getOnboarding());
}

/** First completion is a POST; later edits PATCH only the changed fields. */
export async function saveProfileOnServer(
  profile: OnboardingProfile | Partial<OnboardingProfile>,
  mode: 'complete' | 'update' = 'complete',
) {
  const r = await api<unknown>('/api/onboarding/profile', {
    method: mode === 'complete' ? 'POST' : 'PATCH',
    body: profile,
    ...silent,
  });
  return normalizeOnboarding(r) ?? (await getOnboarding());
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Accepts the contract shape, tolerating `{onboarding:{…}}` wrapping. Returns null if unrecognisable. */
export function normalizeOnboarding(raw: unknown): OnboardingState | null {
  const r = isRecord(raw) && isRecord(raw.onboarding) ? raw.onboarding : raw;
  if (!isRecord(r)) return null;
  const nda = isRecord(r.nda) ? r.nda : null;
  const profile = isRecord(r.profile) ? (r.profile as unknown as OnboardingProfile) : null;
  const signedAt = typeof nda?.signedAt === 'string' ? nda.signedAt : null;
  // `signed` is false when an older NDA version was signed: the stage stays `nda`.
  const ndaSigned = nda && typeof nda.signed === 'boolean' ? nda.signed : !!signedAt;
  let stage: OnboardingState['stage'];
  if (r.stage === 'nda' || r.stage === 'profile' || r.stage === 'ready') stage = r.stage;
  else if (r.required === false) stage = 'ready';
  else if (!ndaSigned) stage = 'nda';
  else if (!profile) stage = 'profile';
  else stage = 'ready';
  return {
    stage,
    nda:
      ndaSigned && signedAt
        ? {
            version: String(nda?.signedVersion ?? nda?.currentVersion ?? ''),
            signedName: typeof nda?.signedName === 'string' ? nda.signedName : '',
            signedAt,
          }
        : null,
    profile,
  };
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/** Always "accepted" for any well-formed email: the server never reveals whether an account exists. */
export const requestRecovery = (email: string) =>
  api<void>('/api/auth/recovery/request', { method: 'POST', body: { email }, ...silent });

export const resetPassword = (token: string, password: string) =>
  api<void>('/api/auth/recovery/reset', { method: 'POST', body: { token, password }, ...silent });

// ---------------------------------------------------------------------------
// Personal access tokens
// ---------------------------------------------------------------------------

export async function listAccessTokens(): Promise<ApiAccessToken[]> {
  const r = await api<ApiAccessToken[] | { items: ApiAccessToken[] }>('/api/tokens');
  return Array.isArray(r) ? r : (r?.items ?? []);
}

export async function createAccessToken(input: {
  name: string;
  scopes: string[];
  expiresInDays: number;
}): Promise<CreatedAccessToken> {
  const r = await api<CreatedAccessToken | { token: string; item: ApiAccessToken }>('/api/tokens', {
    method: 'POST',
    body: input,
  });
  return 'item' in r ? { ...r.item, token: r.token } : r;
}

export const revokeAccessToken = (id: string) =>
  api<void>(`/api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
