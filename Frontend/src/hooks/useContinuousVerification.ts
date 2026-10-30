import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

/** Absolute session lifetime — even an active session must re-authenticate after this. */
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60_000;

/**
 * A coarse, privacy-preserving context fingerprint. It is not used to identify people —
 * only to notice when a live session suddenly appears in a different environment
 * (a classic sign of session hijacking or cookie theft).
 */
function contextFingerprint(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [navigator.userAgent, tz, navigator.language].join('|');
}

/**
 * Continuous identity verification: moves trust checks beyond sign-in.
 * - Locks the session (MFA required to resume) if the device context drifts.
 * - Ends sessions that exceed the absolute lifetime.
 *
 * Timing uses the real wall clock captured on this device when the session was first seen.
 * (Session timestamps elsewhere use the simulated workspace date, so they can't be compared
 * with Date.now() — doing so signed every demo user out immediately.)
 */
export function useContinuousVerification() {
  const { session, lock, signOut, log } = useAuth();
  const sessionId = session?.id;
  const active = !!session && session.mfaVerified && !session.locked;

  useEffect(() => {
    if (!active || !sessionId) return;
    const ctxKey = `devhq.ctx.${sessionId}`;
    const startKey = `devhq.ctx-start.${sessionId}`;
    try {
      if (!sessionStorage.getItem(ctxKey)) sessionStorage.setItem(ctxKey, contextFingerprint());
      if (!sessionStorage.getItem(startKey)) sessionStorage.setItem(startKey, String(Date.now()));
    } catch {
      return; // storage unavailable — skip context binding rather than lock people out
    }

    const check = () => {
      const started = Number(sessionStorage.getItem(startKey));
      if (Number.isFinite(started) && started > 0 && Date.now() - started > MAX_SESSION_MS) {
        log('Session expired', 'Absolute lifetime of 12 hours reached', true);
        signOut('expired');
        return;
      }
      const baseline = sessionStorage.getItem(ctxKey);
      const current = contextFingerprint();
      if (baseline && baseline !== current) {
        sessionStorage.setItem(ctxKey, current);
        log(
          'Session context changed',
          'Device or locale drift detected — re-verification required',
          true,
        );
        lock('Device context changed');
      }
    };

    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => document.visibilityState === 'visible' && check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, sessionId, lock, signOut, log]);
}
