import { useCallback, useEffect, useState } from 'react';
import { setAuthHandlers } from '../../api/client';
import { onAccessRequest, type AccessRequestIntent } from './jit';
import { RequestAccessDialog } from './RequestAccessDialog';

/**
 * Mounted once beside the toaster. When any request comes back `403
 * elevation_required`, it opens "Request production access" for the scope the
 * server named; pages can also open it directly (`openAccessRequest`).
 */
export function JitAccessHost() {
  const [intent, setIntent] = useState<AccessRequestIntent | null>(null);

  useEffect(() => {
    setAuthHandlers({
      elevationRequired: (cause) => {
        const scope = cause.elevationScope;
        if (!scope) return;
        setIntent({
          scope,
          message: `The server refused this action: it changes ${scope} and you have no active grant for it. Request time-boxed access, and try again once it is approved.`,
        });
      },
    });
    const off = onAccessRequest(setIntent);
    return () => {
      setAuthHandlers({ elevationRequired: undefined });
      off();
    };
  }, []);

  const close = useCallback(() => setIntent(null), []);
  // Mounted only while open, so nothing is fetched for members who never need it.
  return intent ? <RequestAccessDialog intent={intent} onClose={close} /> : null;
}
