import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ReauthDialog, type ReauthRequest } from '../components/security/ReauthDialog';
import { setAuthHandlers } from '../api/client';
import { useAuth } from './AuthContext';

interface ReauthValue {
  /**
   * Gate a sensitive action behind re-verification. `onConfirm` runs only after
   * the server accepted a fresh TOTP code or passkey; if it returns a promise
   * the dialog stays busy until it settles and shows its error if it rejects.
   */
  requestReauth: (req: ReauthRequest) => void;
}

const ReauthContext = createContext<ReauthValue | null>(null);

type Waiter = (verified: boolean) => void;

/**
 * Two ways into re-verification:
 *  1. A page asks first (`requestReauth`) for an action it knows is sensitive.
 *  2. The API client hits `401 step_up_required`; every request waiting on it
 *     shares one dialog, and each is retried by the client once verified (or
 *     rejected with `step_up_cancelled` if the person cancels).
 * While the lock screen is up it owns verification, so implicit requests wait
 * for the unlock instead of stacking a dialog under it.
 */
export function ReauthProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [request, setRequest] = useState<ReauthRequest | null>(null);
  const waiters = useRef<Waiter[]>([]);
  const lockedRef = useRef(false);
  lockedRef.current = !!session?.locked;
  const signedIn = !!session;

  const settle = useCallback((verified: boolean) => {
    const list = waiters.current;
    waiters.current = [];
    list.forEach((w) => w(verified));
  }, []);

  const requestReauth = useCallback((req: ReauthRequest) => setRequest(req), []);

  useEffect(() => {
    setAuthHandlers({
      stepUp: () =>
        new Promise<boolean>((resolve) => {
          waiters.current.push(resolve);
          if (lockedRef.current) return;
          setRequest(
            (current) =>
              current ?? {
                title: 'Confirm it’s you',
                description:
                  'Your verification expired or this request came from a new context. Confirm with your authenticator or passkey and DevHQ will finish the action.',
                actionLabel: 'Verify & continue',
                successMessage: 'Verified — continuing',
                implicit: true,
              },
          );
        }),
    });
    return () => setAuthHandlers({ stepUp: undefined });
  }, []);

  // Unlocking the lock screen is a server-accepted step-up: release anything waiting on it.
  useEffect(() => {
    if (session && !session.locked && waiters.current.length && !request) settle(true);
  }, [session, request, settle]);

  // Signing out cancels every pending re-verification.
  useEffect(() => {
    if (!signedIn) {
      setRequest(null);
      settle(false);
    }
  }, [signedIn, settle]);

  const onVerified = useCallback(() => settle(true), [settle]);
  const onClose = useCallback(() => {
    setRequest(null);
    settle(false);
  }, [settle]);
  const onDone = useCallback(() => setRequest(null), []);

  const value = useMemo(() => ({ requestReauth }), [requestReauth]);
  return (
    <ReauthContext.Provider value={value}>
      {children}
      <ReauthDialog request={request} onVerified={onVerified} onDone={onDone} onCancel={onClose} />
    </ReauthContext.Provider>
  );
}

export function useReauth() {
  const ctx = useContext(ReauthContext);
  if (!ctx) throw new Error('useReauth must be used inside ReauthProvider');
  return ctx;
}
