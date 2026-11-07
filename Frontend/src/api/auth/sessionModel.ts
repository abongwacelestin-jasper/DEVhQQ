/**
 * The browser's view of "who am I and how far through sign-in am I".
 *
 * Everything here is *derived* from server answers (`/api/auth/session`,
 * `/api/auth/pending`, `/api/onboarding`). There is no client-side notion of
 * being verified or onboarded that the server has not confirmed.
 */

import { roleKeyFor, type RoleKey } from '../../data/roles';
import type { SessionRecord } from '../../types/session';
import type { ApiMember, ApiSessionView, OnboardingProfile, OnboardingState } from '../types';

export type Profile = OnboardingProfile;

export type AuthStage = 'signed-out' | 'mfa' | 'nda' | 'profile' | 'ready';

/** The public, stable shape every page reads through `useAuth().session`. */
export interface Session {
  /** The server session id prefix (what `/api/auth/sessions/:prefix` revokes). */
  id: string;
  roleKey: RoleKey;
  memberId: string;
  method: 'demo' | 'password' | 'passkey' | 'sso';
  /** The server accepted the second factor for this session. */
  mfaVerified: boolean;
  trustedDevice: boolean;
  ndaSignedAt?: string;
  ndaName?: string;
  profile?: Profile;
  profileComplete: boolean;
  /** Server onboarding stage; `ready` when the server enforces none. */
  onboardingStage: OnboardingState['stage'];
  signedInAt: string;
  locked: boolean;
  lockedAt?: string;
}

/** What the server told us about the current session. */
export interface Identity {
  member: ApiMember;
  verified: boolean;
  method: Session['method'];
  mfaMethods: string[];
  /** Password-only session for a member with no second factor: enrollment finishes sign-in. */
  enrollRequired: boolean;
  serverSessionId: string;
  signedInAt: string;
  trustedDevice: boolean;
}

export interface LockState {
  locked: boolean;
  lockedAt?: string;
}

export function stageOf(s: Session | null): AuthStage {
  if (!s) return 'signed-out';
  if (!s.mfaVerified) return 'mfa';
  if (s.onboardingStage === 'nda') return 'nda';
  if (s.onboardingStage === 'profile') return 'profile';
  return 'ready';
}

/**
 * `onboarding` is `undefined` while loading and `null` when the backend has no
 * onboarding module (then the server enforces no NDA/profile stage).
 */
export function toSession(
  identity: Identity,
  onboarding: OnboardingState | null | undefined,
  lock: LockState,
): Session {
  return {
    id: identity.serverSessionId,
    roleKey: roleKeyFor(identity.member.role),
    memberId: identity.member.id,
    method: identity.method,
    mfaVerified: identity.verified,
    trustedDevice: identity.trustedDevice,
    ndaSignedAt: onboarding?.nda?.signedAt || undefined,
    ndaName: onboarding?.nda?.signedName || undefined,
    profile: onboarding?.profile ?? undefined,
    profileComplete: !!onboarding?.profile || onboarding?.stage === 'ready' || onboarding === null,
    onboardingStage: onboarding?.stage ?? 'ready',
    signedInAt: identity.signedInAt,
    locked: lock.locked,
    lockedAt: lock.lockedAt,
  };
}

/** Server sessions in the record shape the lock screen and session lists already render. */
export function toSessionRecords(
  views: ApiSessionView[],
  roleOf: (memberId: string) => RoleKey,
): SessionRecord[] {
  return views.map((v) => ({
    id: v.id,
    memberId: v.memberId,
    roleKey: roleOf(v.memberId),
    // SessionRecord has no passkey method; both server methods end in a verified second factor.
    method: 'password',
    device: v.client,
    location: [v.location?.city, v.location?.country].filter(Boolean).join(', ') || 'Unknown',
    ip: v.ip,
    startedAt: v.createdAt,
    lastSeenAt: v.lastSeenAt,
    idleMs: 0,
    events: [],
  }));
}
