import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, type AuthStage } from '../../contexts/AuthContext';
import { pathForStage } from '../../utils/authRoutes';

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
  const { stage: current, role, booting } = useAuth();
  if (booting) return null;
  const allowed = Array.isArray(stage) ? stage : [stage];
  if (!allowed.includes(current)) return <Navigate to={pathForStage(current, role)} replace />;
  return <>{children}</>;
}

/** Guards the whole app: only fully onboarded sessions get through. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { stage, role, booting } = useAuth();
  if (booting) return null;
  if (stage !== 'ready') return <Navigate to={pathForStage(stage, role)} replace />;
  return <>{children}</>;
}
