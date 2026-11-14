import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import type { ApiDeployment } from '../api/types';
import { useAuth } from '../contexts/AuthContext';
import { NOW, relative } from '../utils/date';
import type { Deployment } from '../types/operations';
import { onServerEvents } from '../components/engineering/data/events';

/** The UI row plus the server fields charts and topology derive from. */
export interface DeploymentRow extends Deployment {
  createdAt: string;
  version: string;
  requestedBy: string;
  approvedBy?: string;
}

/**
 * Deployments as the API knows them.
 *
 * The API records and approves; the CI/CD provider executes. Nothing here
 * changes local state on the strength of a button press alone — every
 * transition is a request, and a failure puts the row back as the server has it.
 */

/**
 * "20h", "3d" — relative to the real clock. Records come from the API with
 * real timestamps; older seeded records that predate the workspace's
 * simulated clock fall back to its formatter.
 */
function agoOf(iso: string) {
  const t = new Date(iso).getTime();
  const ms = Date.now() - t;
  if (t < NOW.getTime()) return relative(new Date(iso)).replace(/ ago$/, '');
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

export interface DeployActionError {
  id: string;
  action: 'approve' | 'rollback';
  error: unknown;
}

export function toDeployment(d: ApiDeployment): DeploymentRow {
  return {
    id: d.id,
    createdAt: d.createdAt,
    version: d.version,
    requestedBy: d.requestedBy,
    approvedBy: d.approvedBy,
    product: d.product,
    env: d.env,
    sha: d.sha,
    message: d.version,
    author: d.requestedBy,
    provider: d.provider,
    status: d.status,
    ago: agoOf(d.createdAt),
    // Pipeline timings aren't recorded by the API, so they aren't invented here.
    duration: '—',
  };
}

export function useDeployments() {
  const { session, allows } = useAuth();
  // A role without Deployment:view gets an empty list, not a 403 and an error toast.
  const memberId = allows('Deployment') ? (session?.memberId ?? null) : null;
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  /** The last failed approve/rollback, for an inline message next to the action. */
  const [actionError, setActionError] = useState<DeployActionError | null>(null);

  const reload = useCallback(async () => {
    const rows = await api<ApiDeployment[]>('/api/deployments');
    setDeployments(rows.map(toDeployment));
    setError(null);
  }, []);

  useEffect(() => {
    if (!memberId) {
      setDeployments([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    reload()
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        toast.error("Couldn't load deployments", {
          description: e instanceof Error ? e.message : 'The deployments API did not respond.',
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [memberId, reload]);

  // Approvals and simulated rollouts finish on the server; the stream says when to re-read.
  useEffect(() => {
    if (!memberId) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onServerEvents(['deployment'], () => {
      clearTimeout(t);
      t = setTimeout(() => void reload().catch(() => undefined), 300);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [memberId, reload]);

  const transition = useCallback(
    async (id: string, action: 'approve' | 'rollback', success: string) => {
      setActionError(null);
      try {
        const updated = await api<ApiDeployment>(
          `/api/deployments/${encodeURIComponent(id)}/${action}`,
          { method: 'POST' },
        );
        setDeployments((l) => l.map((d) => (d.id === updated.id ? toDeployment(updated) : d)));
        toast.success(success, { description: `${updated.sha} · ${updated.status}` });
        return updated;
      } catch (e) {
        // Shown inline by the page (403 self-approval, 409 not pending, …).
        setActionError({ id, action, error: e });
        void reload().catch(() => undefined);
        return null;
      }
    },
    [reload],
  );

  const approve = useCallback(
    (id: string) => transition(id, 'approve', 'Deployment approved'),
    [transition],
  );
  const rollback = useCallback(
    (id: string) => transition(id, 'rollback', 'Rollback started'),
    [transition],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    deployments,
    approve,
    rollback,
    reload,
    loading,
    error,
    actionError,
    clearActionError,
  };
}
