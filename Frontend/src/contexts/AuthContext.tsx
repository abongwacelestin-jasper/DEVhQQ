/**
 * Identity for the whole app, composed from focused modules in `api/auth/`:
 *
 * - `useSessionState` — cookie-only session bootstrap, server sessions, directory, capabilities
 * - `useSignIn`       — password, TOTP, passkey and demo sign-in
 * - `useOnboarding`   — server-authoritative NDA + profile stages
 * - `useLock`         — lock screen, step-up (TOTP or passkey), idle preference
 *
 * `useAuth()` keeps the shape the rest of the app already consumes.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  roleByKey,
  roleKeyFor,
  type Action,
  type Area,
  type DemoRole,
  type RoleKey,
} from '../data/roles';
import { nowISO } from '../utils/date';
import { canPerform, canVisit } from '../api/capabilities';
import {
  revokeSessionByPrefix,
  signOutOthers as signOutOthersOnServer,
} from '../api/auth/endpoints';
import {
  stageOf,
  toSession,
  toSessionRecords,
  type AuthStage,
  type Profile,
  type Session,
} from '../api/auth/sessionModel';
import { useSessionState } from '../api/auth/useSessionState';
import { useSignIn, type SignInResult } from '../api/auth/useSignIn';
import { useOnboarding } from '../api/auth/useOnboarding';
import { useLock } from '../api/auth/useLock';
import type { NdaCommitment } from '../api/auth/endpoints';
import type { ApiMember, ApiSessionView } from '../api/types';
import type { Member } from '../types/team';
import type { ProductId } from '../types/portfolio';
import type { SessionEndReason, SessionEventKind, SessionRecord } from '../types/session';

export { stageOf };
export type { AuthStage, Profile, Session, SignInResult };

export interface AuthEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  sensitive?: boolean;
}

interface AuthValue {
  session: Session | null;
  role: DemoRole | null;
  stage: AuthStage;
  /**
   * The member id once the second factor is verified, else null. Data providers key
   * their fetches on this so nothing calls the API with a password-only session.
   */
  readyMemberId: string | null;
  /** True while the session probe is in flight — routes must not redirect during it. */
  booting: boolean;
  /** Set when the server could not be reached at boot (not when signed out). */
  bootError: string | null;
  retryBoot: () => Promise<void>;
  /** Re-reads the session from the server without unmounting the app (e.g. after adding a passkey). */
  refresh: () => Promise<void>;
  /** The signed-in member as the server returned it. */
  member: ApiMember | null;
  /** The team directory from `/api/team` (empty until loaded). */
  directory: Member[];
  /** Second-factor methods the server offers for a password-only session. */
  mfaMethods: string[];
  /** Password accepted but the member has no second factor: they must enroll one to finish. */
  enrollRequired: boolean;
  /** Confirms first-factor enrollment during sign-in; throws the server's error on failure. */
  confirmEnrollment: (code: string) => Promise<void>;
  /** Server says this session needs a fresh strong verification before sensitive actions. */
  stepUpRequired: boolean;
  lockedUntil: number | null;
  failedAttempts: number;
  /** Sign-in events from this tab (the authoritative record is the server audit log). */
  authEvents: AuthEvent[];
  /** Live server sessions for this member, in the record shape the UI renders. */
  sessions: SessionRecord[];
  serverSessions: ApiSessionView[];
  refreshSessions: () => Promise<ApiSessionView[]>;
  idleMinutes: number;
  setIdleMinutes: (n: number) => void;
  signInDemo: (key: RoleKey) => Promise<void>;
  signInPassword: (email: string, password: string) => Promise<SignInResult>;
  signInPasskey: () => Promise<SignInResult>;
  verifyMfa: (code: string, trust: boolean) => Promise<boolean>;
  /** Second factor with a one-time backup code; resolves with the codes left, or null if refused. */
  verifyBackup: (code: string) => Promise<number | null>;
  signNda: (name: string, commitment?: NdaCommitment) => Promise<SignInResult>;
  completeProfile: (p: Profile) => Promise<SignInResult>;
  updateProfile: (p: Partial<Profile>) => Promise<SignInResult>;
  signOut: (reason?: SessionEndReason) => Promise<void>;
  signOutEverywhere: () => Promise<number>;
  /** Ends every other session of this member; this one stays signed in. Resolves with the count. */
  signOutOthers: () => Promise<number>;
  lock: (note?: string) => void;
  /** Re-verifies with the API (POST /api/auth/step-up). Resolves true only on success. */
  unlock: (code: string) => Promise<boolean>;
  /** Re-verifies with a passkey assertion the server checks. */
  verifyWithPasskey: () => Promise<SignInResult>;
  trackSession: (kind: SessionEventKind, note?: string) => void;
  /** Revokes one of this member's sessions on the server. */
  revokeSession: (id: string) => Promise<void>;
  log: (action: string, target: string, sensitive?: boolean) => void;
  requestAccess: (target: string) => void;
  can: (area: Area) => boolean;
  canDo: (action: Action) => boolean;
  canSeeProduct: (p: ProductId) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

const TRACKED: Partial<Record<SessionEventKind, string>> = {
  'idle-warning': 'Idle warning shown',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const state = useSessionState();
  const { identity, onboarding, lockState, capabilities, directory, serverSessions } = state;
  const [authEvents, setAuthEvents] = useState<AuthEvent[]>([]);
  const actorRef = useRef<string>('');
  actorRef.current = identity?.member.id ?? '';

  const log = useCallback((action: string, target: string, sensitive?: boolean) => {
    setAuthEvents((l) =>
      [
        {
          id: `ae${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
          at: nowISO(),
          actor: actorRef.current || 'unknown',
          action,
          target,
          sensitive,
        },
        ...l,
      ].slice(0, 200),
    );
  }, []);

  const signIn = useSignIn(state, log);
  const onboard = useOnboarding(state, log);
  const locking = useLock(state, log);

  const { signOut: endServerSession, signOutAll, refreshSessions, endLocalSession } = state;

  const signOut = useCallback(
    async (reason: SessionEndReason = 'signed-out') => {
      if (actorRef.current) log('Signed out', reason);
      await endServerSession();
    },
    [endServerSession, log],
  );

  const signOutEverywhere = useCallback(async () => {
    const n = await signOutAll();
    log('Signed out everywhere', `${n} session(s)`, true);
    return n;
  }, [signOutAll, log]);

  const signOutOthers = useCallback(async () => {
    const r = await signOutOthersOnServer();
    const n = r?.revoked ?? 0;
    log('Signed out other sessions', `${n} session(s)`, true);
    await refreshSessions();
    return n;
  }, [refreshSessions, log]);

  const revokeSession = useCallback(
    async (id: string) => {
      const target = serverSessions.find((s) => s.id === id);
      await revokeSessionByPrefix(id);
      log(
        'Revoked session',
        target ? `${target.client} · ${target.location?.city ?? ''}` : id,
        true,
      );
      if (target?.current) endLocalSession();
      else await refreshSessions();
    },
    [serverSessions, refreshSessions, endLocalSession, log],
  );

  const trackSession = useCallback(
    (kind: SessionEventKind, note?: string) => {
      const label = TRACKED[kind];
      if (label) log(label, note ?? '');
    },
    [log],
  );

  const { hydrate, identityRef } = state;
  const refresh = useCallback(async () => {
    await hydrate({
      method: identityRef.current?.method,
      trustedDevice: identityRef.current?.trustedDevice,
    });
  }, [hydrate, identityRef]);

  const requestAccess = useCallback((target: string) => log('Requested access', target), [log]);

  const session = useMemo(
    () => (identity ? toSession(identity, onboarding, lockState) : null),
    [identity, onboarding, lockState],
  );
  const role = session ? roleByKey(session.roleKey) : null;
  const member = identity?.member ?? null;

  const sessions = useMemo(
    () =>
      toSessionRecords(serverSessions, (id) =>
        id === member?.id
          ? roleKeyFor(member.role)
          : roleKeyFor(directory.find((m) => m.id === id)?.role ?? ''),
      ),
    [serverSessions, member, directory],
  );

  // Verified, but onboarding not answered yet: still booting as far as routing is concerned.
  const booting = state.booting || (!!identity?.verified && onboarding === undefined);

  const can = useCallback(
    (area: Area) => (role ? canVisit(capabilities, area, role.areas) : false),
    [role, capabilities],
  );
  const canDo = useCallback(
    (action: Action) => (role ? canPerform(capabilities, action, role.actions) : false),
    [role, capabilities],
  );
  const canSeeProduct = useCallback(
    (p: ProductId) => {
      if (!role) return false;
      if (capabilities) return capabilities.products.includes(p);
      return role.key === 'admin' || !!member?.products.includes(p);
    },
    [role, capabilities, member],
  );

  const value = useMemo<AuthValue>(
    () => ({
      session,
      role,
      stage: stageOf(session),
      readyMemberId: identity?.verified ? (session?.memberId ?? null) : null,
      booting,
      bootError: state.bootError,
      retryBoot: state.retryBoot,
      refresh,
      member,
      directory,
      mfaMethods: identity?.mfaMethods ?? [],
      enrollRequired: !!identity && !identity.verified && identity.enrollRequired,
      confirmEnrollment: signIn.confirmEnrollment,
      stepUpRequired: state.stepUpRequired,
      lockedUntil: signIn.lockedUntil,
      failedAttempts: signIn.failedAttempts,
      authEvents,
      sessions,
      serverSessions,
      refreshSessions,
      idleMinutes: locking.idleMinutes,
      setIdleMinutes: locking.setIdleMinutes,
      signInDemo: signIn.signInDemo,
      signInPassword: signIn.signInPassword,
      signInPasskey: signIn.signInPasskey,
      verifyMfa: signIn.verifyMfa,
      verifyBackup: signIn.verifyBackup,
      signNda: onboard.signNda,
      completeProfile: onboard.completeProfile,
      updateProfile: onboard.updateProfile,
      signOut,
      signOutEverywhere,
      signOutOthers,
      lock: locking.lock,
      unlock: locking.unlock,
      verifyWithPasskey: locking.verifyWithPasskey,
      trackSession,
      revokeSession,
      log,
      requestAccess,
      can,
      canDo,
      canSeeProduct,
    }),
    [
      session,
      role,
      booting,
      state.bootError,
      state.retryBoot,
      refresh,
      member,
      directory,
      identity,
      state.stepUpRequired,
      signIn.lockedUntil,
      signIn.failedAttempts,
      signIn.signInDemo,
      signIn.signInPassword,
      signIn.signInPasskey,
      signIn.verifyMfa,
      signIn.verifyBackup,
      signIn.confirmEnrollment,
      authEvents,
      sessions,
      serverSessions,
      refreshSessions,
      locking.idleMinutes,
      locking.setIdleMinutes,
      locking.lock,
      locking.unlock,
      locking.verifyWithPasskey,
      onboard.signNda,
      onboard.completeProfile,
      onboard.updateProfile,
      signOut,
      signOutEverywhere,
      signOutOthers,
      trackSession,
      revokeSession,
      log,
      requestAccess,
      can,
      canDo,
      canSeeProduct,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
