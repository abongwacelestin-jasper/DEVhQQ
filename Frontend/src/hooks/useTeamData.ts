import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { toMember } from '../api/adapters';
import type { ApiGrant, ApiMember, ApiPermissionMatrix, ApiProduct } from '../api/types';
import { useAuth } from '../contexts/AuthContext';
import { useWork } from '../contexts/WorkContext';
import type { Member, RoleName } from '../types/team';

export interface MemberPatch {
  role?: RoleName;
  products?: ApiProduct[];
  status?: 'active' | 'deactivated';
}

/**
 * The team directory as the API knows it.
 *
 * Members, the role × area matrix and just-in-time grants all come from the
 * server, so a role change or a revoked account is visible here the moment the
 * server has applied it — the page keeps no private copy of who holds what.
 */
export function useTeamData() {
  const { session } = useAuth();
  const { tasks } = useWork();
  const memberId = session?.memberId ?? null;

  const [directory, setDirectory] = useState<ApiMember[]>([]);
  const [matrix, setMatrix] = useState<ApiPermissionMatrix | null>(null);
  const [grants, setGrants] = useState<ApiGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [team, roles, access] = await Promise.allSettled([
      api<ApiMember[]>('/api/team'),
      api<ApiPermissionMatrix>('/api/team/roles'),
      api<ApiGrant[]>('/api/access/grants'),
    ]);
    const missing: string[] = [];
    if (team.status === 'fulfilled') setDirectory(team.value);
    else missing.push('members');
    if (roles.status === 'fulfilled') setMatrix(roles.value);
    else missing.push('roles');
    // Grants need Administration:view — a role without it gets an empty list, not an error.
    if (access.status === 'fulfilled') setGrants(access.value);
    setError(missing.length ? `Couldn't load ${missing.join(', ')}.` : null);
  }, []);

  useEffect(() => {
    if (!memberId) {
      setDirectory([]);
      setGrants([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    reload().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [memberId, reload]);

  /** Workload is counted from the task list, so it moves when work moves. */
  const members: Member[] = useMemo(() => {
    const openByMember = new Map<string, number>();
    tasks.forEach((t) => {
      if (t.status === 'done') return;
      openByMember.set(t.assignee, (openByMember.get(t.assignee) ?? 0) + 1);
    });
    return directory.map((m) => {
      const base = toMember(m);
      return {
        ...base,
        openTasks: openByMember.get(base.id) ?? 0,
        // The API reports MFA as a boolean; the cards show the account's real state.
        mfa: !!m.mfa,
      };
    });
  }, [directory, tasks]);

  /** Role / product / status changes go through the server, then resync. */
  const updateMember = useCallback(
    async (id: string, patch: MemberPatch) => {
      await api<ApiMember>(`/api/team/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
      });
      await reload();
    },
    [reload],
  );

  const pendingGrants = grants.filter((g) => g.status === 'pending');
  const activeGrants = grants.filter((g) => g.status === 'active');

  return {
    members,
    matrix,
    grants,
    pendingGrants,
    activeGrants,
    loading,
    error,
    reload,
    updateMember,
  };
}
