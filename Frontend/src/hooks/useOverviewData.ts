import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { toMember } from '../api/adapters';
import type { ApiMember, ApiProductSummary, ApiProject } from '../api/types';
import { useAuth } from '../contexts/AuthContext';
import { useIncidents } from '../contexts/IncidentContext';
import { useWork } from '../contexts/WorkContext';
import { useDeployments } from './useDeployments';
import { daysAgo } from '../utils/metrics';
import type { Deployment } from '../types/operations';
import type { Health, ProductId } from '../types/portfolio';
import type { Member } from '../types/team';

/**
 * Everything the Overview page shows, read from the API.
 *
 * Counts (tasks, projects, members) come from /api/products, which the server
 * computes against the caller's scope — the browser never adds up numbers from
 * a different scope than the one being displayed. Deployments and incidents
 * come from the same providers the delivery pages use, so a row seen here is
 * the row that page acts on.
 */

/** A product row: live counts plus a health verdict derived from them. */
export interface ProductRow {
  id: ProductId;
  name: string;
  code: string;
  health: Health;
  reasons: string[];
  openTasks: number;
  lateTasks: number;
  projects: number;
  members: number;
  openIncidents: number;
  lastDeploy: Deployment | null;
}


export function useOverviewData() {
  const { session } = useAuth();
  const memberId = session?.memberId ?? null;
  const { deployments } = useDeployments();
  const { incidents } = useIncidents();
  const { tasks } = useWork();

  const [products, setProducts] = useState<ApiProductSummary[]>([]);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [directory, setDirectory] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberId) {
      setProducts([]);
      setProjects([]);
      setDirectory([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    Promise.allSettled([
      api<ApiProductSummary[]>('/api/products'),
      api<ApiProject[]>('/api/projects'),
      api<ApiMember[]>('/api/team'),
    ]).then(([productResult, projectResult, teamResult]) => {
      if (!alive) return;
      const missing: string[] = [];
      if (productResult.status === 'fulfilled') setProducts(productResult.value);
      else missing.push('products');
      if (projectResult.status === 'fulfilled') setProjects(projectResult.value);
      else missing.push('projects');
      if (teamResult.status === 'fulfilled') setDirectory(teamResult.value.map(toMember));
      else missing.push('team');
      setError(missing.length ? `Couldn't load ${missing.join(', ')}.` : null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [memberId]);

  /** Workload is derived from the loaded tasks, so it updates when work changes. */
  const team = useMemo(() => {
    const openByMember = new Map<string, number>();
    tasks.forEach((t) => {
      if (t.status === 'done') return;
      openByMember.set(t.assignee, (openByMember.get(t.assignee) ?? 0) + 1);
    });
    return directory.map((m) => ({ ...m, openTasks: openByMember.get(m.id) ?? 0 }));
  }, [directory, tasks]);

  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved'),
    [incidents],
  );

  const rows: ProductRow[] = useMemo(
    () =>
      products.map((p) => {
        const productDeploys = deployments.filter((d) => d.product === p.id);
        const latest = productDeploys.find((d) => d.status !== 'running') ?? null;
        const failed = productDeploys.filter(
          (d) => (d.status === 'failed' || d.status === 'rolled-back') && daysAgo(d.ago) < 7,
        ).length;
        const awaiting = productDeploys.filter((d) => d.status === 'awaiting-approval').length;
        const incidentsHere = openIncidents.filter((i) => i.product === p.id);

        const reasons: string[] = [];
        if (incidentsHere.length) {
          reasons.push(
            `${incidentsHere.length} open incident${incidentsHere.length === 1 ? '' : 's'} (${incidentsHere[0].severity})`,
          );
        }
        if (p.lateTasks) reasons.push(`${p.lateTasks} overdue task${p.lateTasks === 1 ? '' : 's'}`);
        if (failed) reasons.push(`${failed} failed deploy${failed === 1 ? '' : 's'} this week`);
        if (awaiting) reasons.push(`${awaiting} deploy${awaiting === 1 ? '' : 's'} awaiting approval`);
        if (!reasons.length) {
          reasons.push(
            p.openTasks
              ? `${p.openTasks} open task${p.openTasks === 1 ? '' : 's'}, none overdue`
              : 'No open work and no open incidents',
          );
        }

        const health: Health =
          incidentsHere.length > 0 || p.lateTasks >= 3
            ? 'at-risk'
            : p.lateTasks > 0 || failed > 0 || awaiting > 0
              ? 'degraded'
              : 'healthy';

        return {
          id: p.id,
          name: p.name,
          code: p.code,
          health,
          reasons,
          openTasks: p.openTasks,
          lateTasks: p.lateTasks,
          projects: p.projects,
          members: p.members,
          openIncidents: incidentsHere.length,
          lastDeploy: latest,
        };
      }),
    [products, deployments, openIncidents],
  );

  return {
    rows,
    products,
    projects,
    team,
    loading,
    error,
    openIncidents,
    deployments,
    incidents,
  };
}
