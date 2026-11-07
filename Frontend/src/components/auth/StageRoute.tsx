import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CloudOffIcon, LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import { useAuth, type AuthStage } from '../../contexts/AuthContext';
import { pathForStage } from '../../utils/authRoutes';

/** Shown when the session probe could not reach the server — never confused with "signed out". */
function BootError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <section
        role="alert"
        aria-live="assertive"
        className="w-full max-w-sm rounded-2xl border border-line bg-white p-5 text-center shadow-pop"
      >
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-warn-soft text-warn">
          <CloudOffIcon className="h-5 w-5" />
        </span>
        <h1 className="mt-3 text-[15px] font-semibold text-ink">Can’t reach DevHQ</h1>
        <p className="mt-1 text-[12.5px] text-muted">{message}</p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onRetry();
            setBusy(false);
          }}
          className="mx-auto mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90 disabled:opacity-60"
        >
          {busy ? (
            <LoaderCircleIcon className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCwIcon className="h-4 w-4" />
          )}
          Try again
        </button>
      </section>
    </main>
  );
}

/**
 * Renders an auth/onboarding screen only at its own stage; otherwise sends the visitor where they belong.
 * While the session probe is in flight nothing is rendered — redirecting then would bounce a
 * signed-in user to /sign-in for a frame.
 */
export function StageRoute({
  stage,
  children,
}: {
  stage: AuthStage | AuthStage[];
  children: React.ReactNode;
}) {
  const { stage: current, role, booting, bootError, retryBoot } = useAuth();
  if (bootError) return <BootError message={bootError} onRetry={retryBoot} />;
  if (booting) return null;
  const allowed = Array.isArray(stage) ? stage : [stage];
  if (!allowed.includes(current)) return <Navigate to={pathForStage(current, role)} replace />;
  return <>{children}</>;
}

/** Guards the whole app: only fully onboarded sessions get through. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { stage, role, booting, bootError, retryBoot } = useAuth();
  if (bootError) return <BootError message={bootError} onRetry={retryBoot} />;
  if (booting) return null;
  if (stage !== 'ready') return <Navigate to={pathForStage(stage, role)} replace />;
  return <>{children}</>;
}
