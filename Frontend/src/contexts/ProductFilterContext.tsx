import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { ScopeResponse } from '../api/types';
import { useAuth } from './AuthContext';
import { products } from '../data/portfolio';
import { projects as projectSeeds } from '../data/work';
import type { Product, ProductId } from '../types/portfolio';
import type { Project } from '../types/work';

type Selection = ProductId | 'all';
type ProjectSelection = string | 'all';

interface ScopeTarget {
  product: ProductId;
  projectId?: string;
}

interface ProductFilterValue {
  /** Selected product (driven automatically when a project is picked). */
  selected: Selection;
  setSelected: (s: Selection) => void;
  /** Selected project — narrows every scoped view below the product level. */
  project: ProjectSelection;
  setProject: (p: ProjectSelection) => void;
  activeProject: Project | undefined;
  activeProduct: Product | undefined;
  /** True when the product is both permitted for the signed-in role and inside the current scope. */
  matches: (p: ProductId) => boolean;
  /** Product match plus project match — use for tasks, docs, channels and anything carrying a projectId. */
  matchesTask: (t: ScopeTarget) => boolean;
  /** Use for project lists. */
  matchesProject: (projectId: string, product: ProductId) => boolean;
  allowedProducts: Product[];
  allowedProjects: Project[];
  clearScope: () => void;
  /** Human-readable label of the current scope, e.g. "RenewBerry / Payments v2". */
  scopeLabel: string;
}

const STORAGE_KEY = 'devhq.scope.v1';
const ProductFilterContext = createContext<ProductFilterValue | null>(null);

function readStored(): { selected: Selection; project: ProjectSelection } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { selected: 'all', project: 'all' };
    const parsed = JSON.parse(raw) as { selected?: string; project?: string };
    const sel = products.some((p) => p.id === parsed.selected)
      ? (parsed.selected as ProductId)
      : 'all';
    const proj = projectSeeds.some((p) => p.id === parsed.project)
      ? (parsed.project as string)
      : 'all';
    return { selected: sel, project: proj };
  } catch {
    return { selected: 'all', project: 'all' };
  }
}

/**
 * The API owns which projects exist and who leads them. The seed file only
 * supplies presentation fields the API has no business storing (timeline weeks,
 * milestones), so a project the server doesn't know about can never appear.
 */
function mergeProjects(scope: ScopeResponse['projects']): Project[] {
  return scope.map((p) => {
    const seed = projectSeeds.find((x) => x.id === p.id);
    return {
      id: p.id,
      product: p.product,
      name: p.name,
      status: p.status,
      lead: p.lead,
      objective: seed?.objective ?? '',
      startWeek: seed?.startWeek ?? 0,
      endWeek: seed?.endWeek ?? 4,
      milestone: seed?.milestone ?? { name: p.name, week: 4 },
      done: seed?.done ?? 0,
      total: seed?.total ?? 0,
    };
  });
}

export function ProductFilterProvider({ children }: { children: React.ReactNode }) {
  const { canSeeProduct, session } = useAuth();
  const initial = useMemo(readStored, []);
  const [selected, setSelectedState] = useState<Selection>(initial.selected);
  const [project, setProjectState] = useState<ProjectSelection>(initial.project);
  const [projects, setProjects] = useState<Project[]>(projectSeeds);

  // Scope comes from the server, scoped to the caller's products.
  useEffect(() => {
    if (!session?.memberId) return;
    let alive = true;
    api<ScopeResponse>('/api/scope')
      .then((scope) => {
        if (alive) setProjects(mergeProjects(scope.projects));
      })
      .catch(() => {
        /* the last known project list stays usable; individual calls still authorize server-side */
      });
    return () => {
      alive = false;
    };
  }, [session?.memberId]);

  const allowedProducts = useMemo(
    () => products.filter((p) => canSeeProduct(p.id)),
    [canSeeProduct],
  );
  const allowedProjects = useMemo(
    () => projects.filter((p) => canSeeProduct(p.product)),
    [projects, canSeeProduct],
  );

  // A role change can revoke access to the stored scope — reset to a safe default.
  useEffect(() => {
    setSelectedState((s) => (s !== 'all' && !canSeeProduct(s) ? 'all' : s));
    setProjectState((p) => {
      const pr = projects.find((x) => x.id === p);
      return pr && canSeeProduct(pr.product) ? p : 'all';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.roleKey]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ selected, project }));
    } catch {
      /* storage unavailable — scope stays in memory */
    }
  }, [selected, project]);

  const setSelected = useCallback(
    (s: Selection) => {
      setSelectedState(s);
      // Picking a different product drops a project that belongs elsewhere.
      setProjectState((p) => {
        if (p === 'all') return p;
        const pr = projects.find((x) => x.id === p);
        return pr && (s === 'all' || pr.product === s) && s !== 'all' ? p : 'all';
      });
    },
    [projects],
  );

  const setProject = useCallback(
    (p: ProjectSelection) => {
      setProjectState(p);
      if (p !== 'all') {
        const pr = projects.find((x) => x.id === p);
        if (pr) setSelectedState(pr.product);
      }
    },
    [projects],
  );

  const clearScope = useCallback(() => {
    setSelectedState('all');
    setProjectState('all');
  }, []);

  const matches = useCallback(
    (p: ProductId) => canSeeProduct(p) && (selected === 'all' || selected === p),
    [selected, canSeeProduct],
  );
  const matchesTask = useCallback(
    (t: ScopeTarget) =>
      matches(t.product) && (project === 'all' || !t.projectId || t.projectId === project),
    [matches, project],
  );
  const matchesProject = useCallback(
    (projectId: string, product: ProductId) =>
      matches(product) && (project === 'all' || project === projectId),
    [matches, project],
  );

  const activeProject = project === 'all' ? undefined : projects.find((p) => p.id === project);
  const activeProduct = selected === 'all' ? undefined : products.find((p) => p.id === selected);
  const scopeLabel = activeProject
    ? `${activeProduct?.name ?? ''} / ${activeProject.name}`
    : (activeProduct?.name ?? 'All products');

  const value = useMemo(
    () => ({
      selected,
      setSelected,
      project,
      setProject,
      activeProject,
      activeProduct,
      matches,
      matchesTask,
      matchesProject,
      allowedProducts,
      allowedProjects,
      clearScope,
      scopeLabel,
    }),
    [
      selected,
      setSelected,
      project,
      setProject,
      activeProject,
      activeProduct,
      matches,
      matchesTask,
      matchesProject,
      allowedProducts,
      allowedProjects,
      clearScope,
      scopeLabel,
    ],
  );
  return <ProductFilterContext.Provider value={value}>{children}</ProductFilterContext.Provider>;
}

export function useProductFilter() {
  const ctx = useContext(ProductFilterContext);
  if (!ctx) throw new Error('useProductFilter must be used inside ProductFilterProvider');
  return ctx;
}
