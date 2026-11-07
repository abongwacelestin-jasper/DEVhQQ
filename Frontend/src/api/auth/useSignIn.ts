/**
 * Sign-in and second factor: password → TOTP or passkey, passkey-only sign-in,
 * and one-step demo access (only when the server enables it).
 *
 * Each path asks the server to do the work and then re-reads the session from
 * the server (`hydrate`), so the browser never decides it is verified.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../client';
import type { RoleKey } from '../../data/roles';
import {
  confirmSignInEnrollment,
  passkeyCeremony,
  signInDemoRole,
  signInWithPassword,
  verifyBackupCode,
  verifyTotp,
} from './endpoints';
import type { SessionState } from './useSessionState';
import { describeWebAuthnError } from '../../utils/webauthn';

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export function useSignIn(
  state: SessionState,
  log: (action: string, target: string, sensitive?: boolean) => void,
) {
  const { hydrate, identityRef } = state;
  const [failedAttempts, setFailed] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  useEffect(() => {
    if (!lockedUntil) return;
    const t = setTimeout(
      () => {
        setLockedUntil(null);
        setFailed(0);
      },
      Math.max(0, lockedUntil - Date.now()),
    );
    return () => clearTimeout(t);
  }, [lockedUntil]);

  /** One-step demo sign-in: the API creates a verified session for the demo role. Throws on failure. */
  const signInDemo = useCallback(
    async (key: RoleKey) => {
      await signInDemoRole(key);
      const me = await hydrate({ method: 'demo' });
      if (!me) throw new Error('The server did not start a session. Try again.');
      log('Signed in', `${me.member.role} · demo access`);
    },
    [hydrate, log],
  );

  /** Step 1 of 2: password. The server issues a password-only session; the second factor is still outstanding. */
  const signInPassword = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      if (lockedUntil && lockedUntil > Date.now())
        return { ok: false, error: 'Too many attempts. Try again shortly.' };
      try {
        await signInWithPassword(email, password);
        const me = await hydrate({ method: 'password' });
        if (!me) return { ok: false, error: 'The server did not start a session. Try again.' };
        setFailed(0);
        log('Password accepted', me.member.role);
        return { ok: true };
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        if (err?.status === 423) {
          const retryAfter = Number(
            (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec ?? 60,
          );
          setLockedUntil(Date.now() + Math.max(1, retryAfter) * 1000);
          return {
            ok: false,
            error: `Too many attempts. Try again in ${Math.max(1, retryAfter)}s.`,
          };
        }
        setFailed((n) => n + 1);
        return { ok: false, error: err?.message ?? 'Sign-in failed.' };
      }
    },
    [hydrate, lockedUntil, log],
  );

  /** Step 2 of 2: the authenticator code, verified by the API. */
  const verifyMfa = useCallback(
    async (code: string, trust: boolean): Promise<boolean> => {
      if (!identityRef.current) return false;
      try {
        await verifyTotp(code);
      } catch {
        return false;
      }
      await hydrate({ method: identityRef.current?.method, trustedDevice: trust });
      log('Verified MFA', 'Authenticator code', true);
      return true;
    },
    [hydrate, identityRef, log],
  );

  /** Step 2 of 2 with a one-time backup code. Resolves with the codes left, or null if refused. */
  const verifyBackup = useCallback(
    async (code: string): Promise<number | null> => {
      if (!identityRef.current) return null;
      let left: number;
      try {
        left = (await verifyBackupCode(code)).backupCodesRemaining ?? 0;
      } catch {
        return null;
      }
      await hydrate({ method: identityRef.current?.method });
      log('Verified MFA', 'Backup code', true);
      return left;
    },
    [hydrate, identityRef, log],
  );

  /**
   * Passkey as the whole sign-in (no session) or as the second factor (password-only session).
   * Resolves with an error message instead of throwing so screens can show it inline.
   */
  const signInPasskey = useCallback(async (): Promise<SignInResult> => {
    try {
      await passkeyCeremony();
      const me = await hydrate({ method: 'passkey' });
      if (!me) return { ok: false, error: 'The server did not start a session. Try again.' };
      log('Signed in', 'Passkey', true);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof ApiError ? e.message : describeWebAuthnError(e),
      };
    }
  }, [hydrate, log]);

  /**
   * Confirms the first authenticator during sign-in. Throws the server's error
   * (wrong code, expired enrollment) so the enrollment form can show it; on
   * success it continues exactly like a normal MFA success.
   */
  const confirmEnrollment = useCallback(
    async (code: string): Promise<void> => {
      await confirmSignInEnrollment(code);
      await hydrate({ method: identityRef.current?.method });
      log('Enrolled authenticator', 'First factor during sign-in', true);
    },
    [hydrate, identityRef, log],
  );

  return {
    failedAttempts,
    lockedUntil,
    signInDemo,
    signInPassword,
    verifyMfa,
    verifyBackup,
    signInPasskey,
    confirmEnrollment,
  };
}
