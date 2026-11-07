/**
 * Lock screen and step-up. Locking is local *and* (where the server supports
 * it) server-side; unlocking always requires the server to accept a fresh
 * TOTP code or passkey assertion — the browser cannot unlock itself.
 */

import { useCallback, useState } from 'react';
import { ApiError } from '../client';
import { describeWebAuthnError } from '../../utils/webauthn';
import { lockOnServer, passkeyCeremony, stepUpTotp } from './endpoints';
import { writeLockMarker, type SessionState } from './useSessionState';
import type { SignInResult } from './useSignIn';

const IDLE = 'devhq.idle-minutes';

function loadIdle() {
  try {
    const n = Number(localStorage.getItem(IDLE));
    return Number.isFinite(n) && n >= 1 && n <= 120 ? n : 15;
  } catch {
    return 15;
  }
}

export function useLock(
  state: SessionState,
  log: (action: string, target: string, sensitive?: boolean) => void,
) {
  const { identityRef, setLockState, setStepUpRequired } = state;
  const [idleMinutes, setIdleState] = useState<number>(loadIdle);

  const lock = useCallback(
    (note = 'Locked manually') => {
      const me = identityRef.current;
      if (!me?.verified) return;
      writeLockMarker(me.member.id);
      setLockState((l) => (l.locked ? l : { locked: true, lockedAt: new Date().toISOString() }));
      log('Locked session', note);
      // Best effort: make the server demand re-verification too, so a reload can't skip the lock.
      void lockOnServer().catch(() => undefined);
    },
    [identityRef, log, setLockState],
  );

  const markVerified = useCallback(
    (how: string) => {
      writeLockMarker(null);
      setLockState({ locked: false });
      setStepUpRequired(false);
      log('Re-verified', how, true);
    },
    [log, setLockState, setStepUpRequired],
  );

  /** Re-verification with an authenticator code (POST /api/auth/step-up). Resolves true only on success. */
  const unlock = useCallback(
    async (code: string): Promise<boolean> => {
      if (!identityRef.current) return false;
      try {
        await stepUpTotp(code);
      } catch {
        return false;
      }
      markVerified('Authenticator code');
      return true;
    },
    [identityRef, markVerified],
  );

  /** Re-verification with a passkey (WebAuthn assertion verified by the server). */
  const verifyWithPasskey = useCallback(async (): Promise<SignInResult> => {
    if (!identityRef.current) return { ok: false, error: 'Your session ended. Sign in again.' };
    try {
      await passkeyCeremony();
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : describeWebAuthnError(e) };
    }
    markVerified('Passkey');
    return { ok: true };
  }, [identityRef, markVerified]);

  const setIdleMinutes = useCallback(
    (n: number) => {
      setIdleState(n);
      try {
        localStorage.setItem(IDLE, String(n));
      } catch {
        /* preference only */
      }
      log('Changed idle lock', `${n} minute${n === 1 ? '' : 's'}`);
    },
    [log],
  );

  return { lock, unlock, verifyWithPasskey, idleMinutes, setIdleMinutes };
}
