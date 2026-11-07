/**
 * Server-authoritative onboarding stage.
 *
 * Mirrors the frontend's `stageOf` + `needsOnboarding` (data/roles.ts): every
 * role except Owner signs the NDA and completes a profile before reaching
 * `ready`. The `mfa` stage is implicit — these routes require a verified
 * session, so a caller here has always passed MFA.
 */

import type { Member, RoleName } from '../../types.ts';
import { NDA_TEXT_HASH, NDA_VERSION } from './nda.ts';

export type OnboardingStage = 'nda' | 'profile' | 'ready';

/** Roles with `needsOnboarding: true` in Frontend/src/data/roles.ts. */
export const ONBOARDING_ROLES: readonly RoleName[] = [
  'Project manager',
  'Developer',
  'Designer',
  'Tester',
  'Operations',
];

export function needsOnboarding(m: Member): boolean {
  return ONBOARDING_ROLES.includes(m.role);
}

export function ndaCurrent(m: Member): boolean {
  return !!m.ndaSignedAt && m.ndaVersion === NDA_VERSION;
}

export function stageOf(m: Member): OnboardingStage {
  if (!needsOnboarding(m)) return 'ready';
  if (!ndaCurrent(m)) return 'nda';
  if (!m.profile) return 'profile';
  return 'ready';
}

export function onboardingView(m: Member) {
  return {
    memberId: m.id,
    stage: stageOf(m),
    required: needsOnboarding(m),
    nda: {
      currentVersion: NDA_VERSION,
      textHash: NDA_TEXT_HASH,
      signed: ndaCurrent(m),
      signedVersion: m.ndaVersion ?? null,
      signedAt: m.ndaSignedAt ?? null,
    },
    profile: m.profile ?? null,
    profileComplete: !!m.profile,
  };
}
