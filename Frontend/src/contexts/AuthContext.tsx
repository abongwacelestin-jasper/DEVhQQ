import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  roleByKey,
  roleKeyFor,
  type Action,
  type Area,
  type DemoRole,
  type RoleKey,
} from '../data/roles';
import { members, setCurrentUserId, setMembers } from '../data/team';
import { seedSessions } from '../data/sessions';
import { nowISO } from '../utils/date';
import { api, ApiError, getToken, rememberToken, setAuthHandlers, setToken } from '../api/client';
import { toMember } from '../api/adapters';
import { canPerform, canVisit } from '../api/capabilities';
import type {
  ApiMember,
  AuthenticatedResponse,
  Capabilities,
  PendingResponse,
  SessionResponse,
  SignInResponse,
  StepUpResponse,
} from '../api/types';
import type { ProductId } from '../types/portfolio';
import type { SessionEndReason, SessionEventKind, SessionRecord } from '../types/session';

export interface Profile {
  displayName: string;
  timezone: string;
  hoursFrom: string;
  hoursTo: string;
  skills: string[];
  notify: string[];
}

export interface Session {
  id: string;
  roleKey: RoleKey;
  memberId: string;
  method: 'demo' | 'password' | 'sso';
  mfaVerified: boolean;
  trustedDevice: boolean;
  ndaSignedAt?: string;
  ndaName?: string;
  profile?: Profile;
  profileComplete: boolean;
  signedInAt: string;
  locked: boolean;
  lockedAt?: string;
}

export interface AuthEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  sensitive?: boolean;
}

export type AuthStage = 'signed-out' | 'mfa' | 'nda' | 'profile' | 'ready';

export interface SignInResult {
  ok: boolean;
  error?: string;
}

interface AuthValue {
  session: Session | null;
  role: DemoRole | null;
  stage: AuthStage;
  /** True while the session probe is in flight — routes must not redirect during it. */
  booting: boolean;
  /** Server says this session needs a fresh strong verification before sensitive actions. */
  stepUpRequired: boolean;
  lockedUntil: number | null;
  failedAttempts: number;
  authEvents: AuthEvent[];
  sessions: SessionRecord[];
  idleMinutes: number;
  setIdleMinutes: (n: number) => void;
  signInDemo: (key: RoleKey) => Promise<void>;
  signInPassword: (email: string, password: string) => Promise<SignInResult>;
  verifyMfa: (code: string, trust: boolean) => Promise<boolean>;
  signNda: (name: string) => boolean;
  completeProfile: (p: Profile) => void;
  updateProfile: (p: Partial<Profile>) => void;
  signOut: (reason?: SessionEndReason) => Promise<void>;
  lock: (note?: string) => void;
  /** Re-verifies with the API (POST /api/auth/step-up). Resolves true only on success. */
  unlock: (code: string) => Promise<boolean>;
  trackSession: (kind: SessionEventKind, note?: string) => void;
  revokeSession: (id: string) => void;
  log: (action: string, target: string, sensitive?: boolean) => void;
  requestAccess: (target: string) => void;
  can: (area: Area) => boolean;
  canDo: (action: Action) => boolean;
  canSeeProduct: (p: ProductId) => boolean;
}

const HISTORY = 'devhq.session-history.v2';
const IDLE = 'devhq.idle-minutes';
const ONBOARDING = 'devhq.onboarding.v1';
const AuthContext = createContext<AuthValue | null>(null);

interface Onboarding {
  ndaSignedAt?: string;
  ndaName?: string;
  profile?: Profile;
}

function readOnboarding(memberId: string): Onboarding {
  try {
    const raw = sessionStorage.getItem(`${ONBOARDING}.${memberId}`);
    return raw ? (JSON.parse(raw) as Onboarding) : {};
  } catch {
    return {};
  }
}

function writeOnboarding(memberId: string, patch: Onboarding) {
  try {
    const next = { ...readOnboarding(memberId), ...patch };
    sessionStorage.setItem(`${ONBOARDING}.${memberId}`, JSON.stringify(next));
  } catch {
    /* storage unavailable — onboarding stays in memory for this page life */
  }
}

function isRecord(v: unknown): v is SessionRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<SessionRecord>;
  return (
    typeof r.id === 'string' &&
    typeof r.memberId === 'string' &&
    typeof r.startedAt === 'string' &&
    Array.isArray(r.events)
  );
}

/** History survives tab closes (localStorage). Any record still open that isn't this tab's session was closed with its tab. */
function loadHistory(currentId?: string): SessionRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const list = Array.isArray(parsed) ? parsed.filter(isRecord) : seedSessions;
    return list.map((r) =>
      !r.endedAt && r.id !== currentId && !r.id.startsWith('s-')
        ? {
            ...r,
            endedAt: r.lastSeenAt ?? r.startedAt,
            endReason: 'tab-closed',
            events: [
              ...r.events,
              { at: r.lastSeenAt ?? r.startedAt, kind: 'end', note: 'Browser tab closed' },
            ],
          }
        : r,
    );
  } catch {
    return seedSessions;
  }
}

function loadIdle() {
  const n = Number(localStorage.getItem(IDLE));
  return Number.isFinite(n) && n >= 1 && n <= 120 ? n : 15;
}

function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Mac/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} · ${os}`;
}

export function stageOf(s: Session | null): AuthStage {
  if (!s) return 'signed-out';
  if (!s.mfaVerified) return 'mfa';
  const role = roleByKey(s.roleKey);
  if (role.needsOnboarding && !s.ndaSignedAt) return 'nda';
  if (role.needsOnboarding && !s.profileComplete) return 'profile';
  return 'ready';
}

/** Builds the local session record from the member the API says we are. */
function buildSession(
  member: ApiMember,
  opts: { verified: boolean; method: Session['method']; locked?: boolean },
): Session {
  const onboarding = readOnboarding(member.id);
  return {
    id: `ls${Date.now()}`,
    roleKey: roleKeyFor(member.role),
    memberId: member.id,
    method: opts.method,
    mfaVerified: opts.verified,
    trustedDevice: false,
    ndaSignedAt: onboarding.ndaSignedAt,
    ndaName: onboarding.ndaName,
    profile: onboarding.profile,
    profileComplete: !!onboarding.profile,
    signedInAt: nowISO(),
    locked: !!opts.locked,
    lockedAt: opts.locked ? nowISO() : undefined,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [failedAttempts, setFailed] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [authEvents, setAuthEvents] = useState<AuthEvent[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadHistory());
  const [idleMinutes, setIdleState] = useState<number>(loadIdle);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Keep the shared "current user" binding in step with the session before children render.
  if (session) setCurrentUserId(session.memberId);

  useEffect(() => {
    localStorage.setItem(HISTORY, JSON.stringify(sessions.slice(0, 80)));
  }, [sessions]);

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

  /** Directory + effective permissions come from the server; both are best-effort so a hiccup never blocks sign-in. */
  const loadDirectory = useCallback(async () => {
    const [team, caps] = await Promise.allSettled([
      api<ApiMember[]>('/api/team'),
      api<Capabilities>('/api/me/capabilities'),
    ]);
    if (team.status === 'fulfilled' && Array.isArray(team.value))
      setMembers(team.value.map(toMember));
    if (caps.status === 'fulfilled' && caps.value?.matrix) setCapabilities(caps.value);
  }, []);

  // Session bootstrap: the HttpOnly cookie (or the bearer fallback) is the only proof of identity we trust.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const current = await api<SessionResponse>('/api/auth/session', { silent: true });
        if (!alive) return;
        setSession(
          buildSession(current.member, {
            verified: true,
            method: 'password',
            locked: current.stepUpRequired,
          }),
        );
        setStepUpRequired(!!current.stepUpRequired);
        setCurrentUserId(current.member.id);
        void loadDirectory();
      } catch (e) {
        if (!alive) return;
        // 401 is the normal signed-out answer; anything else is a real problem worth surfacing.
        if (!(e instanceof ApiError) || e.status !== 401) setFailed((n) => n);
        if (!getToken()) setToken(null);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadDirectory]);

  const endLocalSession = useCallback(() => {
    setToken(null);
    setSession(null);
    setCapabilities(null);
    setStepUpRequired(false);
    setCurrentUserId('m1');
  }, []);

  useEffect(() => {
    setAuthHandlers({ signedOut: endLocalSession });
  }, [endLocalSession]);

  const log = useCallback((action: string, target: string, sensitive?: boolean, actor?: string) => {
    setAuthEvents((l) => [
      {
        id: `ae${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        at: nowISO(),
        actor: actor ?? sessionRef.current?.memberId ?? 'm1',
        action,
        target,
        sensitive,
      },
      ...l,
    ]);
  }, []);

  const patchRecord = useCallback((id: string, fn: (r: SessionRecord) => SessionRecord) => {
    setSessions((l) => l.map((r) => (r.id === id ? fn(r) : r)));
  }, []);

  const trackSession = useCallback(
    (kind: SessionEventKind, note?: string) => {
      const s = sessionRef.current;
      if (!s) return;
      const at = nowISO();
      patchRecord(s.id, (r) => ({
        ...r,
        lastSeenAt: at,
        events: [...r.events, { at, kind, note }],
      }));
    },
    [patchRecord],
  );

  // Heartbeat + close tracking: last-seen every 30s, and a final record when the tab closes or hides.
  useEffect(() => {
    if (!session?.mfaVerified) return;
    const id = session.id;
    const beat = setInterval(
      () => patchRecord(id, (r) => ({ ...r, lastSeenAt: nowISO() })),
      30_000,
    );
    const onVis = () => trackSession(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
    const onClose = () => {
      try {
        const list = JSON.parse(localStorage.getItem(HISTORY) ?? '[]') as SessionRecord[];
        const at = nowISO();
        localStorage.setItem(
          HISTORY,
          JSON.stringify(list.map((r) => (r.id === id ? { ...r, lastSeenAt: at } : r))),
        );
      } catch {
        /* storage unavailable */
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onClose);
    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onClose);
    };
  }, [session?.id, session?.mfaVerified, patchRecord, trackSession]);

  const startRecord = useCallback((s: Session, method: Session['method']) => {
    const at = nowISO();
    setSessions((l) => [
      {
        id: s.id,
        memberId: s.memberId,
        roleKey: s.roleKey,
        method,
        device: deviceName(),
        location: 'This browser',
        ip: '102.89.xx.xx',
        startedAt: at,
        lastSeenAt: at,
        idleMs: 0,
        events: [{ at, kind: 'start', note: method === 'demo' ? 'Demo access' : method }],
      },
      ...l.filter((r) => r.id !== s.id),
    ]);
  }, []);

  /** One-step demo sign-in: the API creates a verified session for the demo role. */
  const signInDemo = useCallback(
    async (key: RoleKey) => {
      const r = await api<AuthenticatedResponse>('/api/auth/demo', {
        method: 'POST',
        body: { role: key },
        silent: true,
      });
      rememberToken(r);
      const next = buildSession(r.member, { verified: true, method: 'demo' });
      setSession(next);
      setCurrentUserId(r.member.id);
      setStepUpRequired(false);
      startRecord(next, 'demo');
      log('Signed in', `${roleByKey(key).label} · demo access`, false, r.member.id);
      void loadDirectory();
    },
    [log, startRecord, loadDirectory],
  );

  /** Step 1 of 2: password. The API returns a partial session; the second factor is still outstanding. */
  const signInPassword = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      if (lockedUntil && lockedUntil > Date.now())
        return { ok: false, error: 'Too many attempts. Try again shortly.' };
      try {
        const r = await api<SignInResponse>('/api/auth/sign-in', {
          method: 'POST',
          body: { email, password },
          silent: true,
        });
        rememberToken(r);
        const pending = await api<PendingResponse>('/api/auth/pending', { silent: true });
        const next = buildSession(pending.member, { verified: false, method: 'password' });
        setSession(next);
        setCurrentUserId(pending.member.id);
        setFailed(0);
        startRecord(next, 'password');
        log('Password accepted', roleByKey(next.roleKey).label, false, pending.member.id);
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
        const n = failedAttempts + 1;
        setFailed(n);
        return { ok: false, error: err?.message ?? 'Sign-in failed.' };
      }
    },
    [failedAttempts, lockedUntil, log, startRecord],
  );

  /** Step 2 of 2: the authenticator code, verified by the API. */
  const verifyMfa = useCallback(
    async (code: string, trust: boolean): Promise<boolean> => {
      if (!sessionRef.current) return false;
      try {
        const r = await api<AuthenticatedResponse>('/api/auth/mfa/totp', {
          method: 'POST',
          body: { code },
          silent: true,
        });
        rememberToken(r);
        setSession((s) => (s ? { ...s, mfaVerified: true, trustedDevice: trust } : s));
        trackSession('mfa', trust ? 'Device trusted 30 days' : 'One-time code');
        log('Verified MFA', trust ? 'Device trusted for 30 days' : 'One-time verification', true);
        void loadDirectory();
        return true;
      } catch {
        return false;
      }
    },
    [log, trackSession, loadDirectory],
  );

  const signNda = useCallback(
    (name: string) => {
      const s = sessionRef.current;
      if (!s) return false;
      const member = members.find((m) => m.id === s.memberId);
      if (!member || name.trim().toLowerCase() !== member.name.toLowerCase()) return false;
      writeOnboarding(s.memberId, { ndaSignedAt: nowISO(), ndaName: name.trim() });
      setSession({ ...s, ndaSignedAt: nowISO(), ndaName: name.trim() });
      log('Signed NDA', 'Mutual NDA v3.2 · IP 102.89.xx.xx', true);
      return true;
    },
    [log],
  );

  const completeProfile = useCallback(
    (p: Profile) => {
      const s = sessionRef.current;
      if (!s) return;
      writeOnboarding(s.memberId, { profile: p });
      setSession({ ...s, profile: p, profileComplete: true });
      log('Completed profile', `${p.timezone} · ${p.skills.length} skills`);
    },
    [log],
  );

  const updateProfile = useCallback(
    (p: Partial<Profile>) => {
      setSession((s) => {
        if (!s) return s;
        const m = members.find((x) => x.id === s.memberId);
        const base: Profile = s.profile ?? {
          displayName: m?.name ?? '',
          timezone: 'Africa/Lagos (WAT)',
          hoursFrom: '09:00',
          hoursTo: '17:00',
          skills: [],
          notify: [],
        };
        const next = { ...base, ...p };
        writeOnboarding(s.memberId, { profile: next });
        return { ...s, profile: next };
      });
      log('Updated profile', Object.keys(p).join(', '));
    },
    [log],
  );

  const signOut = useCallback(
    async (reason: SessionEndReason = 'signed-out') => {
      const s = sessionRef.current;
      if (s) {
        const at = nowISO();
        patchRecord(s.id, (r) => ({
          ...r,
          endedAt: at,
          lastSeenAt: at,
          endReason: reason,
          events: [
            ...r.events,
            {
              at,
              kind: 'end',
              note: reason === 'account-closed' ? 'Account closed' : 'Signed out',
            },
          ],
        }));
        log('Signed out', roleByKey(s.roleKey).label);
      }
      try {
        await api('/api/auth/sign-out', { method: 'POST', silent: true });
      } catch {
        /* the local session ends regardless: a server hiccup must never trap someone in the app */
      }
      endLocalSession();
    },
    [log, patchRecord, endLocalSession],
  );

  const lock = useCallback(
    (note = 'Locked manually') => {
      const s = sessionRef.current;
      if (!s || s.locked) return;
      setSession({ ...s, locked: true, lockedAt: nowISO() });
      trackSession('lock', note);
    },
    [trackSession],
  );

  /** Re-verification through the API. This is what makes approvals and role changes real. */
  const unlock = useCallback(
    async (code: string): Promise<boolean> => {
      const s = sessionRef.current;
      if (!s) return false;
      try {
        const r = await api<StepUpResponse>('/api/auth/step-up', {
          method: 'POST',
          body: { code },
          silent: true,
        });
        rememberToken(r);
        const idle = s.lockedAt ? Math.max(0, Date.now() - new Date(s.lockedAt).getTime()) : 0;
        setSession({ ...s, locked: false, lockedAt: undefined });
        setStepUpRequired(false);
        patchRecord(s.id, (rec) => ({ ...rec, idleMs: rec.idleMs + idle }));
        trackSession('unlock', 'MFA re-verification');
        log('Unlocked session', 'MFA re-verification', true);
        return true;
      } catch {
        return false;
      }
    },
    [log, patchRecord, trackSession],
  );

  const revokeSession = useCallback(
    (id: string) => {
      const at = nowISO();
      const target = sessions.find((r) => r.id === id);
      patchRecord(id, (r) => ({
        ...r,
        endedAt: at,
        endReason: 'revoked',
        events: [
          ...r.events,
          {
            at,
            kind: 'end',
            note: `Revoked by ${members.find((m) => m.id === sessionRef.current?.memberId)?.name ?? 'admin'}`,
          },
        ],
      }));
      if (target)
        log(
          'Revoked session',
          `${members.find((m) => m.id === target.memberId)?.name} · ${target.device}`,
          true,
        );
    },
    [sessions, patchRecord, log],
  );

  const setIdleMinutes = useCallback(
    (n: number) => {
      setIdleState(n);
      localStorage.setItem(IDLE, String(n));
      log('Changed idle lock', `${n} minute${n === 1 ? '' : 's'}`);
    },
    [log],
  );

  const requestAccess = useCallback((target: string) => log('Requested access', target), [log]);
  const publicLog = useCallback(
    (action: string, target: string, sensitive?: boolean) => log(action, target, sensitive),
    [log],
  );

  const role = session ? roleByKey(session.roleKey) : null;
  const member = session ? members.find((m) => m.id === session.memberId) : undefined;

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
      booting,
      stepUpRequired,
      lockedUntil,
      failedAttempts,
      authEvents,
      sessions,
      idleMinutes,
      setIdleMinutes,
      signInDemo,
      signInPassword,
      verifyMfa,
      signNda,
      completeProfile,
      updateProfile,
      signOut,
      lock,
      unlock,
      trackSession,
      revokeSession,
      log: publicLog,
      requestAccess,
      can,
      canDo,
      canSeeProduct,
    }),
    [
      session,
      role,
      booting,
      stepUpRequired,
      lockedUntil,
      failedAttempts,
      authEvents,
      sessions,
      idleMinutes,
      setIdleMinutes,
      signInDemo,
      signInPassword,
      verifyMfa,
      signNda,
      completeProfile,
      updateProfile,
      signOut,
      lock,
      unlock,
      trackSession,
      revokeSession,
      publicLog,
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
