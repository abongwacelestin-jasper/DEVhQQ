import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import type { ApiDeployment } from '../api/types';
import { useAuth } from '../contexts/AuthContext';
import { NOW, relative } from '../utils/date';
import type { Deployment } from '../types/operations';

/**
 * Deployments as the API knows them.
 *
 * The API records and approves; the CI/CD provider executes. Nothing here
 * changes local state on the strength of a button press alone — every
 * transition is a request, and a failure puts the row back as the server has it.
 */

function toDeployment(d: ApiDeployment): Deployment {
  return {
    id: d.id,
    product: d.product,
    env: d.env,
    sha: d.sha,
    message: d.version,
    author: d.requestedBy,
    provider: d.provider,
    status: d.status,
    // The workspace runs on a simulated clock; a record stamped after "now" reads as just-now
    // rather than "in 7d".
    ago: new Date(d.createdAt).getTime() > NOW.getTime() ? 'now' : relative(new Date(d.createdAt)),
    // Pipeline timings aren't recorded by the API, so they aren't invented here.
    duration: '—',
  };
}

export function useDeployments() {
  const { session } = useAuth();
  const memberId = session?.memberId ?? null;
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = await api<ApiDeployment[]>('/api/deployments');
    setDeployments(rows.map(toDeployment));
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

  const transition = useCallback(
    async (id: string, action: 'approve' | 'rollback', success: string) => {
      try {
        const updated = await api<ApiDeployment>(
          `/api/deployments/${encodeURIComponent(id)}/${action}`,
          { method: 'POST' },
        );
        setDeployments((l) => l.map((d) => (d.id === updated.id ? toDeployment(updated) : d)));
        toast.success(success, { description: `${updated.sha} · ${updated.status}` });
        return updated;
      } catch (e) {
        toast.error(`${action === 'approve' ? 'Approval' : 'Rollback'} failed`, {
          description: e instanceof Error ? e.message : 'The deployments API did not respond.',
        });
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

  return { deployments, approve, rollback, reload, loading };
}
