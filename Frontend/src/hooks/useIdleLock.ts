import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const WARN_S = 30;

/** Locks the session after the configured idle time, with a 30-second warning first. Returns warning seconds left (or null). */
export function useIdleLock() {
  const { session, lock, idleMinutes, trackSession } = useAuth();
  const active = !!session && !session.locked && session.mfaVerified;
  const [warnLeft, setWarnLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setWarnLeft(null);
      return;
    }
    const total = idleMinutes * 60_000;
    const warnAt = Math.max(0, total - WARN_S * 1000);
    let last = Date.now();
    let warned = false;

    const tick = setInterval(() => {
      const idle = Date.now() - last;
      if (idle >= total) {
        setWarnLeft(null);
        lock(`Idle ${idleMinutes}m`);
      } else if (idle >= warnAt) {
        if (!warned) {
          warned = true;
          trackSession('idle-warning');
        }
        setWarnLeft(Math.ceil((total - idle) / 1000));
      }
    }, 1000);

    const reset = () => {
      last = Date.now();
      if (warned) {
        warned = false;
        setWarnLeft(null);
      }
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [active, lock, idleMinutes, trackSession]);

  return warnLeft;
}
