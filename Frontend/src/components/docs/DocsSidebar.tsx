import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRightIcon,
  ClockIcon,
  HomeIcon,
  LockIcon,
  MessageSquareIcon,
  PencilLineIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
} from 'lucide-react';
import { ProductMark } from '../ui/ProductMark';
import { DocKindIcon } from './docKindIcons';
import type { Project } from '../../types/work';
import type { ProjectDoc } from '../../types/docs';

export type DocsView = 'all' | 'starred' | 'review' | 'mine' | 'recent';

interface DocsSidebarProps {
  docs: ProjectDoc[];
  projects: Project[];
  docId?: string;
  view: DocsView;
  onView: (v: DocsView) => void;
  counts: Record<DocsView, number>;
  query: string;
  onQuery: (q: string) => void;
  activeProjectId?: string;
  onNew?: () => void;
  className?: string;
}

const viewItems: {
  id: DocsView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'all', label: 'All docs', icon: HomeIcon },
  { id: 'recent', label: 'Updated this week', icon: ClockIcon },
  { id: 'starred', label: 'Starred', icon: StarIcon },
  { id: 'review', label: 'Needs review', icon: MessageSquareIcon },
  { id: 'mine', label: 'Edited by me', icon: PencilLineIcon },
];

export function DocsSidebar({
  docs,
  projects,
  docId,
  view,
  onView,
  counts,
  query,
  onQuery,
  activeProjectId,
  onNew,
  className = '',
}: DocsSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [treeOpen, setTreeOpen] = useState(false);
  const groups = projects
    .map((p) => ({ p, items: docs.filter((d) => d.projectId === p.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <aside
      className={`flex min-w-0 shrink-0 flex-col border-b border-line bg-sunken/30 md:sticky md:top-12 md:h-[calc(100dvh-3rem)] md:w-[232px] md:border-b-0 md:border-r lg:w-[248px] ${className}`}
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h1 className="text-[13px] font-semibold text-ink">Docs</h1>
        {onNew && (
          <button
            onClick={onNew}
            aria-label="New doc"
            className="rounded-md p-1 text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      <label className="relative mx-2.5 block">
        <span className="sr-only">Search docs</span>
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search docs"
          className="h-7 w-full rounded-md border border-line bg-white pl-8 pr-2 text-[12.5px] text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-accent"
        />
      </label>

      <nav aria-label="Doc views" className="mt-2 px-1.5">
        <ul className="no-scrollbar -mx-1.5 flex gap-1 overflow-x-auto px-2.5 pb-2 md:mx-0 md:block md:overflow-visible md:px-0 md:pb-0">
          {viewItems.map(({ id, label, icon: Icon }) => {
            const on = !docId && view === id;
            return (
              <li key={id} className="shrink-0">
                <button
                  onClick={() => onView(id)}
                  aria-current={on ? 'page' : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1 text-left text-[12.5px] transition-colors duration-100 md:w-full ${on ? 'bg-white font-medium text-ink shadow-sm ring-1 ring-line' : 'text-muted ring-1 ring-line hover:bg-sunken hover:text-ink md:ring-0'}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{label}</span>
                  {counts[id] > 0 && (
                    <span className="text-[11px] tabular-nums text-subtle">{counts[id]}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <button
        onClick={() => setTreeOpen((o) => !o)}
        aria-expanded={treeOpen}
        className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-left text-[12px] font-medium text-muted hover:text-ink md:hidden"
      >
        <ChevronRightIcon
          className={`h-3.5 w-3.5 transition-transform duration-150 ${treeOpen ? 'rotate-90' : ''}`}
        />
        Browse by project
        <span className="ml-auto text-[11px] tabular-nums text-subtle">{groups.length}</span>
      </button>

      <nav
        aria-label="Docs by project"
        className={`${treeOpen ? 'block max-h-[50vh]' : 'hidden'} min-h-0 flex-1 overflow-y-auto border-t border-line px-1.5 pb-3 pt-2 scroll-thin md:mt-3 md:block md:max-h-none`}
      >
        <p className="hidden px-2 pb-1 text-[11px] font-medium text-subtle md:block">Projects</p>
        {groups.length === 0 && (
          <p className="px-2 py-4 text-[12px] text-muted">No docs in scope.</p>
        )}
        {groups.map(({ p, items }) => {
          const isCollapsed =
            collapsed[p.id] ?? (activeProjectId ? activeProjectId !== p.id : false);
          return (
            <section key={p.id} className="mb-0.5">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [p.id]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] font-medium text-ink hover:bg-sunken"
              >
                <ChevronRightIcon
                  className={`h-3 w-3 shrink-0 text-subtle transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
                />
                <ProductMark product={p.product} size="sm" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="text-[11px] font-normal tabular-nums text-subtle">
                  {items.length}
                </span>
              </button>
              {!isCollapsed && (
                <ul className="mt-0.5">
                  {items.map((d) => {
                    const on = d.id === docId;
                    return (
                      <li key={d.id}>
                        <Link
                          to={`/docs/${d.id}`}
                          aria-current={on ? 'page' : undefined}
                          className={`flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-[12.5px] transition-colors duration-100 ${on ? 'bg-white font-medium text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:bg-sunken hover:text-ink'}`}
                        >
                          <DocKindIcon kind={d.kind} className="h-3 w-3" />
                          <span className="min-w-0 flex-1 truncate">{d.title}</span>
                          {d.visibility === 'restricted' && (
                            <LockIcon
                              className="h-3 w-3 shrink-0 text-subtle"
                              aria-label="Restricted"
                            />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
