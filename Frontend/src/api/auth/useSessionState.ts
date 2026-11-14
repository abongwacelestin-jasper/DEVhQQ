/**
 * Session bootstrap and the server-derived state every other auth module
 * builds on: identity, onboarding stage, lock, live sessions, directory and
 * capabilities.
 *
 * `hydrate()` is the only way the browser learns it is signed in: it asks the
 * server (cookie only) and adopts exactly what the server says. Sign-in, MFA,
 * passkeys and unlock all end by calling it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, setAuthHandlers } from '../client';
import { toMember } from '../adapters';
import type { ApiMember, ApiSessionView, Capabilities, OnboardingState } from '../types';
import type { Member } from '../../types/team';
import { getOnboarding, getPending, getSession, signOutEverywhere, signOutHere } from './endpoints';
import { bindCurrentMember, bindDirectory } from './legacyDirectory';
import type { Identity, LockState, Session } from './sessionModel';

const LOCK_MARKER = 'devhq.lock.v1';

/** A lock survives reloads in this tab (it is a flag, not a credential). */
export function readLockMarker(): string | null {
  try {
    return sessionStorage.getItem(LOCK_MARKER);
  } catch {
    return null;
  }
}

export function writeLockMarker(memberId: string | null) {
  try {
    if (memberId) sessionStorage.setItem(LOCK_MARKER, memberId);
    else sessionStorage.removeItem(LOCK_MARKER);
  } catch {
    /* storage unavailable — the in-memory lock still applies */
  }
}

export interface HydrateHint {
  method?: Session['method'];
  trustedDevice?: boolean;
}

interface Probe {
  identity: Identity;
  stepUpRequired: boolean;
  sessions: ApiSessionView[];
}

/** Asks the server who we are. `null` = signed out; throws on anything that isn't an answer. */
async function probe(hint: HydrateHint): Promise<Probe | null> {
  const now = new Date().toISOString();
  try {
    const s = await getSession();
    const current = s.sessions?.find((x) => x.current);
    // `/api/auth/session` only answers fully verified sessions, but trust the stage it reports.
    const verified = !current || current.stage === 'verified';
    return {
      identity: {
        member: s.member,
        verified,
        method: hint.method ?? current?.method ?? 'password',
        mfaMethods: [],
        enrollRequired: false,
        serverSessionId: current?.id ?? '',
        signedInAt: current?.createdAt ?? now,
        trustedDevice: !!hint.trustedDevice,
      },
      stepUpRequired: !!s.stepUpRequired,
      sessions: s.sessions ?? [],
    };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    if (e.code !== 'mfa_required') return null;
  }
  // Password accepted, second factor outstanding: resume at the MFA step.
  try {
    const p = await getPending();
    return {
      identity: {
        member: p.member,
        verified: false,
        method: hint.method ?? 'password',
        mfaMethods: p.methods ?? [],
        enrollRequired: !!p.enrollRequired || (p.methods ?? []).length === 0,
        serverSessionId: '',
        signedInAt: now,
        trustedDevice: false,
      },
      stepUpRequired: false,
      sessions: [],
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function useSessionState() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  /** `undefined` = not loaded, `null` = server has no onboarding module. */
  const [onboarding, setOnboarding] = useState<OnboardingState | null | undefined>(undefined);
  const [lockState, setLockState] = useState<LockState>({ locked: false });
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [serverSessions, setServerSessions] = useState<ApiSessionView[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [directory, setDirectory] = useState<Member[]>([]);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  /** Directory + effective permissions; best-effort so a hiccup never blocks sign-in. */
  const loadDirectory = useCallback(async () => {
    const [team, caps] = await Promise.allSettled([
      api<ApiMember[]>('/api/team'),
      api<Capabilities>('/api/me/capabilities'),
    ]);
    if (team.status === 'fulfilled' && Array.isArray(team.value)) {
      const list = team.value.map(toMember);
      bindDirectory(list);
      setDirectory(list);
    }
    if (caps.status === 'fulfilled' && caps.value?.matrix) setCapabilities(caps.value);
  }, []);

  const endLocalSession = useCallback(() => {
    bindCurrentMember(null);
    writeLockMarker(null);
    setIdentity(null);
    setOnboarding(undefined);
    setLockState({ locked: false });
    setStepUpRequired(false);
    setServerSessions([]);
    setCapabilities(null);
  }, []);

  const hydrate = useCallback(
    async (hint: HydrateHint = {}): Promise<Identity | null> => {
      const result = await probe(hint);
      if (!result) {
        endLocalSession();
        return null;
      }
      const { identity: next } = result;
      // Directory and capabilities don't depend on the onboarding answer: start them now, in
      // parallel with it, instead of after it (one round trip less before the app has data).
      if (next.verified) void loadDirectory();
      // Onboarding is part of "where am I": load it before adopting the session so routes never flash.
      const ob = next.verified ? await getOnboarding() : undefined;
      bindCurrentMember(next.member.id);
      const marker = readLockMarker();
      const locked = result.stepUpRequired || marker === next.member.id;
      setIdentity(next);
      setOnboarding(ob);
      setStepUpRequired(result.stepUpRequired);
      setServerSessions(result.sessions);
      setLockState((l) =>
        locked
          ? { locked: true, lockedAt: l.lockedAt ?? new Date().toISOString() }
          : { locked: false },
      );
      return next;
    },
    [endLocalSession, loadDirectory],
  );

  const boot = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      await hydrate();
    } catch (e) {
      // 401 is the normal signed-out answer and never reaches here; this is a real outage.
      setBootError(
        e instanceof ApiError && e.status
          ? `TavetaHQ answered with an error (${e.status}${e.requestId ? ` · ${e.requestId}` : ''}).`
          : `Couldn't reach TavetaHQ. Check your connection and try again.`,
      );
    } finally {
      setBooting(false);
    }
  }, [hydrate]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    setAuthHandlers({ signedOut: endLocalSession });
  }, [endLocalSession]);

  const refreshSessions = useCallback(async () => {
    const s = await getSession();
    setServerSessions(s.sessions ?? []);
    setStepUpRequired(!!s.stepUpRequired);
    return s.sessions ?? [];
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutHere();
    } catch {
      /* the local session ends regardless: a server hiccup must never trap someone in the app */
    }
    endLocalSession();
  }, [endLocalSession]);

  const signOutAll = useCallback(async () => {
    const r = await signOutEverywhere();
    endLocalSession();
    return r?.revoked ?? 0;
  }, [endLocalSession]);

  return {
    identity,
    identityRef,
    setIdentity,
    onboarding,
    setOnboarding,
    lockState,
    setLockState,
    stepUpRequired,
    setStepUpRequired,
    serverSessions,
    refreshSessions,
    capabilities,
    directory,
    booting,
    bootError,
    retryBoot: boot,
    hydrate,
    endLocalSession,
    signOut,
    signOutAll,
  };
}

export type SessionState = ReturnType<typeof useSessionState>;
