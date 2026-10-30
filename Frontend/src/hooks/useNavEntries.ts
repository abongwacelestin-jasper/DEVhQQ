import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useWork } from '../contexts/WorkContext';
import { useIncidents } from '../contexts/IncidentContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { navSections, type NavEntry, type NavSection } from '../data/navigation';
import { pullRequests } from '../data/engineering';
import { currentUserId } from '../data/team';

export interface CountedEntry extends NavEntry {
  count?: number;
  alert?: boolean;
}

/** Navigation filtered by the signed-in role and the workspace's enabled modules, with live counts. */
export function useNavEntries() {
  const { can, session } = useAuth();
  const { hasModule } = useWorkspace();
  const { tasks } = useWork();
  const { incidents } = useIncidents();
  const { allowedProducts } = useProductFilter();

  return useMemo(() => {
    const allowed = new Set(allowedProducts.map((p) => p.id));
    const counts: Record<string, { count: number; alert?: boolean }> = {
      '/my-work': {
        count: tasks.filter((t) => t.assignee === currentUserId && t.status !== 'done').length,
      },
      '/test-queue': {
        count: tasks.filter((t) => t.status === 'review' && allowed.has(t.product)).length,
      },
      '/pull-requests': {
        count: pullRequests.filter(
          (p) =>
            allowed.has(p.product) &&
            (p.review === 'review-required' || p.review === 'changes-requested'),
        ).length,
      },
      '/incidents': {
        count: incidents.filter((i) => allowed.has(i.product) && i.status !== 'resolved').length,
        alert: true,
      },
    };
    const sections: (NavSection & { items: CountedEntry[] })[] = navSections
      .map((s) => ({
        ...s,
        items: s.items
          .filter((i) => can(i.area) && (!i.module || hasModule(i.module)))
          .map((i) => ({ ...i, count: counts[i.to]?.count, alert: counts[i.to]?.alert })),
      }))
      .filter((s) => s.items.length > 0);
    const flat = sections.flatMap((s) => s.items);
    return { sections, flat, byPath: (p: string) => flat.find((e) => e.to === p) };
    // session.memberId changes currentUserId, so it must re-run counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, hasModule, tasks, incidents, allowedProducts, session?.memberId]);
}
