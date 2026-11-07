import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '../api/client';
import { useAuth } from './AuthContext';
import {
  errorMessage,
  isUnavailable,
  itemsOf,
  type Availability,
} from '../components/work/apiState';

/**
 * Offboarding on the API (Backend/routes/offboarding.routes.ts):
 *   GET   /api/offboarding            → {items: Resignation[]}  newest first, history included (Administration:view)
 *   GET   /api/offboarding/:memberId  → the member's current Resignation (self or Administration:view; 404 = none)
 *   POST  /api/offboarding/:memberId  {lastDay: YYYY-MM-DD, reason, note?, handoverTo} → 201 Resignation
 *                                      (self-resignation, or Administration:manage) — step-up
 *   PATCH /api/offboarding/:memberId  {step?: {id, done}, status?: 'accepted'|'withdrawn'|'completed',
 *                                      lastDay?, handoverTo?} → Resignation (Administration:manage;
 *                                      a member may withdraw their own pending one) — step-up
 *
 * `status:'completed'` deactivates the member and revokes sessions + JIT grants
 * (and emits an event so personal access tokens are revoked); the response
 * carries `revoked`. Step-up is raised by the API client (ReauthContext), so
 * this context just calls and reports. Every write resyncs from the response.
 */

export type ResignationStatus = 'pending' | 'accepted' | 'withdrawn' | 'completed';

export interface ChecklistStep {
  id: string;
  label: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

export interface Resignation {
  id: string;
  memberId: string;
  lastDay: string;
  reason: string;
  note?: string;
  handoverTo: string;
  submittedAt: string;
  startedBy: string;
  status: ResignationStatus;
  decidedBy?: string;
  decidedAt?: string;
  checklist: ChecklistStep[];
  /** Filled on completion: what the server actually revoked. */
  revoked?: { sessions: number; grants: number; tokens: 'revoked' | 'event-emitted' };
}

type ApiResignation = Resignation;

export type NewResignation = Pick<
  Resignation,
  'memberId' | 'lastDay' | 'reason' | 'note' | 'handoverTo'
>;

export type ResignationAmend = { lastDay?: string; handoverTo?: string };

interface OffboardingValue {
  resignations: Resignation[];
  status: Availability;
  error: string | null;
  /** Starts offboarding for a member. Rejects with the API error so forms can show it inline. */
  submit: (r: NewResignation) => Promise<Resignation>;
  withdraw: (id: string) => Promise<void>;
  /** `by` is ignored — the server records the acting member. Kept for call-site compatibility. */
  decide: (id: string, accept: boolean, by?: string) => Promise<void>;
  toggleStep: (id: string, stepId: string) => Promise<void>;
  complete: (id: string, by?: string) => Promise<void>;
  /** Moves the last day or the handover owner (Administration:manage). */
  amend: (id: string, patch: ResignationAmend) => Promise<void>;
  /** The member's newest offboarding in the loaded list, if any. */
  currentFor: (memberId: string) => Resignation | undefined;
  /** Fetches one member's current offboarding; resolves null when none has been started. */
  load: (memberId: string) => Promise<Resignation | null>;
  reload: () => Promise<void>;
}

const toResignation = (r: ApiResignation): Resignation => r;

const OffboardingContext = createContext<OffboardingValue | null>(null);

export function OffboardingProvider({ children }: { children: React.ReactNode }) {
  const { readyMemberId } = useAuth();
  const memberId = readyMemberId;
  const [resignations, setList] = useState<Resignation[]>([]);
  const [status, setStatus] = useState<Availability>('loading');
  const [error, setError] = useState<string | null>(null);

  const upsert = useCallback((r: Resignation) => {
    // Keyed by resignation id: a member can have history (withdrawn, then restarted).
    setList((l) =>
      [r, ...l.filter((x) => x.id !== r.id)].sort((a, b) =>
        b.submittedAt.localeCompare(a.submittedAt),
      ),
    );
  }, []);

  const reload = useCallback(async () => {
    try {
      // The server scopes this: the whole queue for Administration:view, else your own.
      const body = await api<{ items: ApiResignation[] } | ApiResignation[]>('/api/offboarding');
      setList(itemsOf(body).map(toResignation));
      setStatus('ready');
      setError(null);
    } catch (e) {
      setList([]);
      // 403: this role can't see the offboarding queue — not an outage.
      const forbidden = e instanceof ApiError && e.status === 403;
      setStatus(isUnavailable(e) ? 'unavailable' : forbidden ? 'ready' : 'error');
      setError(forbidden ? null : errorMessage(e, 'The offboarding API did not respond.'));
    }
  }, []);

  useEffect(() => {
    if (!memberId) {
      setList([]);
      setStatus('loading');
      setError(null);
      return;
    }
    void reload();
  }, [memberId, reload]);

  const memberOf = useCallback(
    (id: string) => resignations.find((r) => r.id === id)?.memberId ?? id,
    [resignations],
  );

  const write = useCallback(
    async (action: string, path: string, method: 'POST' | 'PATCH', body: unknown) => {
      try {
        const saved = toResignation(await api<ApiResignation>(path, { method, body }));
        upsert(saved);
        return saved;
      } catch (e) {
        toast.error(`${action} failed`, {
          description: isUnavailable(e)
            ? 'Offboarding isn’t available on this server yet.'
            : errorMessage(e, 'The offboarding API did not respond.'),
        });
        void reload();
        throw e;
      }
    },
    [upsert, reload],
  );

  const path = (member: string) => `/api/offboarding/${encodeURIComponent(member)}`;

  const submit = useCallback<OffboardingValue['submit']>(
    (r) =>
      write('Starting offboarding', path(r.memberId), 'POST', {
        lastDay: r.lastDay,
        reason: r.reason,
        ...(r.note ? { note: r.note } : {}),
        handoverTo: r.handoverTo,
      }),
    [write],
  );

  const amend = useCallback(
    async (id: string, patch: ResignationAmend) => {
      const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (!Object.keys(body).length) return;
      await write('Updating the offboarding', path(memberOf(id)), 'PATCH', body);
    },
    [write, memberOf],
  );

  const currentFor = useCallback(
    (member: string) => resignations.find((r) => r.memberId === member),
    [resignations],
  );

  const setStatusOf = useCallback(
    async (id: string, next: ResignationStatus, action: string) => {
      await write(action, path(memberOf(id)), 'PATCH', { status: next });
    },
    [write, memberOf],
  );

  const withdraw = useCallback(
    (id: string) => setStatusOf(id, 'withdrawn', 'Withdrawing'),
    [setStatusOf],
  );
  const decide = useCallback(
    (id: string, accept: boolean) =>
      setStatusOf(id, accept ? 'accepted' : 'withdrawn', accept ? 'Accepting' : 'Declining'),
    [setStatusOf],
  );
  const complete = useCallback(
    (id: string) => setStatusOf(id, 'completed', 'Completing offboarding'),
    [setStatusOf],
  );

  const toggleStep = useCallback(
    async (id: string, stepId: string) => {
      const r = resignations.find((x) => x.id === id);
      if (!r) return;
      const step = r.checklist.find((c) => c.id === stepId);
      if (!step) return;
      const done = !step.done;
      // Optimistic; the server's response (or a resync on failure) replaces it.
      upsert({
        ...r,
        checklist: r.checklist.map((c) => (c.id === stepId ? { ...c, done } : c)),
      });
      await write('Updating the checklist', path(r.memberId), 'PATCH', {
        step: { id: stepId, done },
      });
    },
    [resignations, upsert, write],
  );

  const load = useCallback(
    async (member: string) => {
      try {
        const r = toResignation(await api<ApiResignation>(path(member)));
        upsert(r);
        return r;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    [upsert],
  );

  const value = useMemo(
    () => ({
      resignations,
      status,
      error,
      submit,
      withdraw,
      decide,
      toggleStep,
      complete,
      amend,
      currentFor,
      load,
      reload,
    }),
    [
      resignations,
      status,
      error,
      submit,
      withdraw,
      decide,
      toggleStep,
      complete,
      amend,
      currentFor,
      load,
      reload,
    ],
  );
  return <OffboardingContext.Provider value={value}>{children}</OffboardingContext.Provider>;
}

export function useOffboarding() {
  const ctx = useContext(OffboardingContext);
  if (!ctx) throw new Error('useOffboarding must be used inside OffboardingProvider');
  return ctx;
}
