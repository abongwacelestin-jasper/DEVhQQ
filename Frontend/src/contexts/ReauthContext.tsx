import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ReauthDialog, type ReauthRequest } from '../components/security/ReauthDialog';
import { setAuthHandlers } from '../api/client';

interface ReauthValue {
  /** Gate a sensitive action behind MFA re-verification. `onConfirm` runs only after a valid code. */
  requestReauth: (req: ReauthRequest) => void;
}

const ReauthContext = createContext<ReauthValue | null>(null);

export function ReauthProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ReauthRequest | null>(null);
  const requestReauth = useCallback((req: ReauthRequest) => setRequest(req), []);

  // The API answers 401 step_up_required when verification has expired or the
  // request context drifted. Open re-verification instead of letting the action
  // fail silently; the user retries once confirmed.
  useEffect(() => {
    setAuthHandlers({
      stepUpRequired: () =>
        setRequest({
          title: 'Re-verification required',
          description:
            'Your verification expired, or this request came from a different context. Confirm with a code, then retry the action.',
          actionLabel: 'Verify',
          onConfirm: () => undefined,
          successMessage: 'Verified — the action can be retried now',
        }),
    });
  }, []);
  const value = useMemo(() => ({ requestReauth }), [requestReauth]);
  return (
    <ReauthContext.Provider value={value}>
      {children}
      <ReauthDialog request={request} onClose={() => setRequest(null)} />
    </ReauthContext.Provider>
  );
}

export function useReauth() {
  const ctx = useContext(ReauthContext);
  if (!ctx) throw new Error('useReauth must be used inside ReauthProvider');
  return ctx;
}
