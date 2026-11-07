/**
 * NDA and profile stages. The server records them (`/api/onboarding/*`) and
 * decides the stage; the browser keeps no copy that could be edited to skip
 * a step.
 */

import { useCallback } from 'react';
import { ApiError } from '../client';
import { NDA_VERSION } from '../../data/nda';
import type { OnboardingState } from '../types';
import { saveProfileOnServer, signNdaOnServer, type NdaCommitment } from './endpoints';
import type { Profile } from './sessionModel';
import type { SessionState } from './useSessionState';
import type { SignInResult } from './useSignIn';

function explain(e: unknown, unavailable: string): string {
  if (e instanceof ApiError) {
    if (e.isUnavailable) return unavailable;
    return e.message;
  }
  return 'Something went wrong. Try again.';
}

export function useOnboarding(
  state: SessionState,
  log: (action: string, target: string, sensitive?: boolean) => void,
) {
  const { identityRef, onboarding, setOnboarding } = state;

  const adopt = useCallback(
    (next: OnboardingState | null) => {
      // A null answer here means the module vanished mid-flow; keep what we had rather than skip stages.
      if (next) setOnboarding(next);
    },
    [setOnboarding],
  );

  const signNda = useCallback(
    async (name: string, commitment?: NdaCommitment): Promise<SignInResult> => {
      const me = identityRef.current;
      if (!me) return { ok: false, error: 'Your session ended. Sign in again.' };
      const signedName = name.trim();
      if (signedName.length < 2) return { ok: false, error: 'Type your full name to sign.' };
      try {
        adopt(await signNdaOnServer(NDA_VERSION, signedName, commitment));
        log('Signed NDA', `Mutual NDA v${NDA_VERSION}`, true);
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: explain(e, 'Agreement signing is not available on this server yet.'),
        };
      }
    },
    [adopt, identityRef, log],
  );

  const completeProfile = useCallback(
    async (p: Profile): Promise<SignInResult> => {
      try {
        adopt(await saveProfileOnServer(p));
        log('Completed profile', `${p.timezone} · ${p.skills.length} skills`);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: explain(e, 'Profiles are not available on this server yet.') };
      }
    },
    [adopt, log],
  );

  const updateProfile = useCallback(
    async (patch: Partial<Profile>): Promise<SignInResult> => {
      if (!identityRef.current) return { ok: false, error: 'Your session ended. Sign in again.' };
      if (!onboarding?.profile)
        return { ok: false, error: 'Complete your profile before editing it.' };
      try {
        adopt(await saveProfileOnServer(patch, 'update'));
        log('Updated profile', Object.keys(patch).join(', '));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: explain(e, 'Profiles are not available on this server yet.') };
      }
    },
    [adopt, identityRef, log, onboarding],
  );

  return { signNda, completeProfile, updateProfile };
}
