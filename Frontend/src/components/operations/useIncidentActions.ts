import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { ApiIncidentAction } from '../../api/types';
import { onServerEvents } from '../engineering/data/events';
import { describeError } from '../engineering/data/useApi';

export type IncidentActionInput = {
  title: string;
  owner: string;
  due: string | null;
  kind: ApiIncidentAction['kind'];
};

export type IncidentActionPatch = Partial<
  Pick<ApiIncidentAction, 'title' | 'owner' | 'due' | 'status' | 'kind'>
>;

/**
 * Recovery steps and follow-ups of one incident, from the API.
 *
 * Writes resolve `true` only once the server has accepted them; the list is
 * then replaced with the server's row, never an optimistic guess. Other
 * viewers' writes arrive as `incident` events and trigger a re-read.
 * `onWritten` runs after each accepted write (the page re-reads the incident
 * so the timeline entry the server added shows up).
 */
export function useIncidentActions(incidentId: string, onWritten?: () => void) {
  const path = `/api/incidents/${encodeURIComponent(incidentId)}/actions`;
  const [items, setItems] = useState<ApiIncidentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Ids with a write in flight (`new` for the add form). */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      setItems(await api<ApiIncidentAction[]>(path));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    void reload();
  }, [reload]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onServerEvents(['incident'], (e) => {
      if (e.data.id !== incidentId) return;
      clearTimeout(t);
      t = setTimeout(() => void reload(), 300);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [incidentId, reload]);

  const track = useCallback(async (key: string, run: () => Promise<void>, what: string) => {
    setBusy((s) => new Set(s).add(key));
    try {
      await run();
      return true;
    } catch (e) {
      toast.error(`${what} failed`, { description: describeError(e) });
      return false;
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const add = useCallback(
    (input: IncidentActionInput) =>
      track(
        'new',
        async () => {
          const created = await api<ApiIncidentAction>(path, {
            method: 'POST',
            body: input,
          });
          setItems((l) => [...l.filter((a) => a.id !== created.id), created]);
          onWritten?.();
          toast.success(
            created.kind === 'mitigation' ? 'Mitigation step added' : 'Follow-up added',
          );
        },
        'Adding the step',
      ),
    [path, track, onWritten],
  );

  const update = useCallback(
    (id: string, patch: IncidentActionPatch, success: string) =>
      track(
        id,
        async () => {
          const updated = await api<ApiIncidentAction>(`${path}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: patch,
          });
          setItems((l) => l.map((a) => (a.id === id ? updated : a)));
          onWritten?.();
          toast.success(success);
        },
        'Updating the step',
      ),
    [path, track, onWritten],
  );

  const remove = useCallback(
    (id: string) =>
      track(
        id,
        async () => {
          await api<void>(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' });
          setItems((l) => l.filter((a) => a.id !== id));
          onWritten?.();
          toast.success('Step deleted');
        },
        'Deleting the step',
      ),
    [path, track, onWritten],
  );

  return { items, loading, error, busy, reload, add, update, remove };
}
