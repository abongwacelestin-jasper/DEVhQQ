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
  const { session } = useAuth();
  const memberId = session?.memberId ?? null;
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [declareOpen, setDeclareOpen] = useState(false);

  const reload = useCallback(async () => {
    const rows = await api<ApiIncident[]>('/api/incidents');
    setIncidents(rows.map(toIncident));
  }, []);

  useEffect(() => {
    if (!memberId) {
      setIncidents([]);
      return;
    }
    let alive = true;
    reload().catch((e) => {
      if (!alive) return;
      toast.error("Couldn't load incidents", {
        description: e instanceof Error ? e.message : 'The incidents API did not respond.',
      });
    });
    return () => {
      alive = false;
    };
  }, [memberId, reload]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>, action = 'Updating the incident') => {
      try {
        const updated = await api<ApiIncident>(`/api/incidents/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body,
        });
        setIncidents((l) => l.map((i) => (i.id === id ? toIncident(updated) : i)));
      } catch (e) {
        toast.error(`${action} failed`, {
          description: e instanceof Error ? e.message : 'The incidents API did not respond.',
        });
        void reload().catch(() => undefined);
      }
    },
    [reload],
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
        return created.id;
      } catch (e) {
        toast.error('Could not declare the incident', {
          description: e instanceof Error ? e.message : 'The incidents API did not respond.',
        });
        throw e;
      }
    },
    [],
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
    () => ({ incidents, declare, setStatus, addEvent, declareOpen, setDeclareOpen, reload }),
    [incidents, declare, setStatus, addEvent, declareOpen, reload],
  );
  return <IncidentContext.Provider value={value}>{children}</IncidentContext.Provider>;
}

export function useIncidents() {
  const ctx = useContext(IncidentContext);
  if (!ctx) throw new Error('useIncidents must be used inside IncidentProvider');
  return ctx;
}
