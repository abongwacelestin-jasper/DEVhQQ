import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import type { ApiIncident } from '../api/types';
import { useAuth } from './AuthContext';
import { currentUserId } from '../data/team';
import { firstName, memberById } from '../utils/status';
import { formatDay, formatTime } from '../utils/date';
import type { Incident, IncidentEvent } from '../types/operations';
import type { ProductId } from '../types/portfolio';
import { onServerEvents } from '../components/engineering/data/events';

export interface DeclareInput {
  title: string;
  product: ProductId;
  service: string;
  severity: Incident['severity'];
  owner: string;
  impact: string;
}

interface IncidentValue {
  incidents: Incident[];
  declare: (input: DeclareInput) => Promise<string>;
  setStatus: (id: string, status: Incident['status'], note?: string) => void;
  addEvent: (id: string, event: Omit<IncidentEvent, 'time'>) => void;
  declareOpen: boolean;
  setDeclareOpen: (v: boolean) => void;
  reload: () => Promise<void>;
  /** True until the first load settles. */
  loading: boolean;
  /** The last load failure; rows stay as they were. */
  error: Error | null;
  /** The last failed write (403/422 …), for inline display. */
  writeError: unknown;
  /** ISO timestamps from the API, keyed by incident id (startedAt/resolvedAt). */
  times: Record<string, { startedAt: string; resolvedAt?: string }>;
}

const IncidentContext = createContext<IncidentValue | null>(null);

/** The server also has "identified"; the web app folds it into investigating. */
const toUiStatus = (s: ApiIncident['status']): Incident['status'] =>
  s === 'resolved' ? 'resolved' : s === 'monitoring' ? 'monitoring' : 'investigating';

function durationOf(start: string, end?: string) {
  const mins = Math.max(
    0,
    Math.round(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 60_000),
  );
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function toIncident(i: ApiIncident): Incident {
  return {
    id: i.id,
    product: i.product,
    title: i.title,
    severity: i.severity,
    status: toUiStatus(i.status),
    owner: i.owner,
    started: `${formatDay(new Date(i.startedAt))}, ${formatTime(new Date(i.startedAt))}`,
    duration: durationOf(i.startedAt, i.resolvedAt),
    service: i.service,
    impact: i.impact,
    events: i.timeline.map((e) => ({
      time: formatTime(new Date(e.at)),
      title: e.note,
      detail: `${memberById(e.by).name} · ${formatDay(new Date(e.at))}`,
      kind: 'note' as const,
    })),
    // No backend field yet: next steps are advice, never presented as recorded state.
    nextSteps: [],
  };
}

export function IncidentProvider({ children }: { children: React.ReactNode }) {
  const { readyMemberId } = useAuth();
  const memberId = readyMemberId;
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [declareOpen, setDeclareOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [writeError, setWriteError] = useState<unknown>(null);
  const [times, setTimes] = useState<IncidentValue['times']>({});

  const remember = useCallback((rows: ApiIncident[]) => {
    setTimes((t) => {
      const next = { ...t };
      rows.forEach((i) => {
        next[i.id] = { startedAt: i.startedAt, resolvedAt: i.resolvedAt };
      });
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    const rows = await api<ApiIncident[]>('/api/incidents');
    setIncidents(rows.map(toIncident));
    remember(rows);
    setError(null);
  }, [remember]);

  useEffect(() => {
    if (!memberId) {
      setIncidents([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    reload()
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        toast.error("Couldn't load incidents", {
          description: e instanceof Error ? e.message : 'The incidents API did not respond.',
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [memberId, reload]);

  // Other members declare and update incidents; the event stream says when to re-read.
  useEffect(() => {
    if (!memberId) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onServerEvents(['incident'], () => {
      clearTimeout(t);
      t = setTimeout(() => void reload().catch(() => undefined), 300);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [memberId, reload]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>, action = 'Updating the incident') => {
      setWriteError(null);
      try {
        const updated = await api<ApiIncident>(`/api/incidents/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body,
        });
        setIncidents((l) => l.map((i) => (i.id === id ? toIncident(updated) : i)));
        remember([updated]);
      } catch (e) {
        setWriteError(e);
        toast.error(`${action} failed`, {
          description: e instanceof Error ? e.message : 'The incidents API did not respond.',
        });
        void reload().catch(() => undefined);
      }
    },
    [reload, remember],
  );

  const addEvent = useCallback(
    (id: string, event: Omit<IncidentEvent, 'time'>) => {
      const time = formatTime(new Date());
      setIncidents((l) =>
        l.map((i) => (i.id === id ? { ...i, events: [...i.events, { ...event, time }] } : i)),
      );
      void patch(id, { note: `${event.title} — ${event.detail}` }, 'Posting the update');
    },
    [patch],
  );

  const declare = useCallback(
    async (input: DeclareInput) => {
      try {
        const created = await api<ApiIncident>('/api/incidents', {
          method: 'POST',
          body: {
            title: input.title,
            product: input.product,
            severity: input.severity,
            owner: input.owner,
            service: input.service,
            impact: input.impact,
          },
        });
        setIncidents((l) => [toIncident(created), ...l]);
        remember([created]);
        return created.id;
      } catch (e) {
        toast.error('Could not declare the incident', {
          description: e instanceof Error ? e.message : 'The incidents API did not respond.',
        });
        throw e;
      }
    },
    [remember],
  );

  const setStatus = useCallback(
    (id: string, status: Incident['status'], note?: string) => {
      setIncidents((l) => l.map((i) => (i.id === id ? { ...i, status } : i)));
      const label = status[0].toUpperCase() + status.slice(1);
      const time = formatTime(new Date());
      setIncidents((l) =>
        l.map((i) =>
          i.id === id
            ? {
                ...i,
                events: [
                  ...i.events,
                  {
                    time,
                    title: `Status → ${label}`,
                    detail: note ?? `Changed by ${firstName(currentUserId)}`,
                    kind: 'system',
                  },
                ],
              }
            : i,
        ),
      );
      void patch(
        id,
        { status, note: note ?? `Changed by ${firstName(currentUserId)}` },
        'Changing the status',
      );
    },
    [patch],
  );

  const value = useMemo(
    () => ({
      incidents,
      declare,
      setStatus,
      addEvent,
      declareOpen,
      setDeclareOpen,
      reload,
      loading,
      error,
      writeError,
      times,
    }),
    [
      incidents,
      declare,
      setStatus,
      addEvent,
      declareOpen,
      reload,
      loading,
      error,
      writeError,
      times,
    ],
  );
  return <IncidentContext.Provider value={value}>{children}</IncidentContext.Provider>;
}

export function useIncidents() {
  const ctx = useContext(IncidentContext);
  if (!ctx) throw new Error('useIncidents must be used inside IncidentProvider');
  return ctx;
}
