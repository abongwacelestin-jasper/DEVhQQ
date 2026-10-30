import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareIcon, StarIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { DocKindIcon } from './docKindIcons';
import { statusTone } from './DocView';
import { docKindMeta } from '../../data/docs';
import { projects } from '../../data/work';
import { firstName } from '../../utils/status';
import { relative } from '../../utils/date';
import type { DocKind, DocStatus, ProjectDoc } from '../../types/docs';

export type DocSort = 'updated' | 'title';

interface DocsHomeProps {
  title: string;
  scopeLabel: string;
  docs: ProjectDoc[];
  kind: DocKind | '';
  onKind: (k: DocKind | '') => void;
  status: DocStatus | '';
  onStatus: (s: DocStatus | '') => void;
  sort: DocSort;
  onSort: (s: DocSort) => void;
  isStarred: (id: string) => boolean;
  toggleStar: (id: string) => void;
  onTemplate?: (k: DocKind) => void;
  showTemplates: boolean;
  emptyHint: string;
}

const kinds = Object.keys(docKindMeta) as DocKind[];

export function DocsHome({
  title,
  scopeLabel,
  docs,
  kind,
  onKind,
  status,
  onStatus,
  sort,
  onSort,
  isStarred,
  toggleStar,
  onTemplate,
  showTemplates,
  emptyHint,
}: DocsHomeProps) {
  const sorted = [...docs].sort((a, b) =>
    sort === 'title' ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <section aria-label={title} className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-end gap-3 border-b border-line px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
          <p className="text-[12px] text-muted">
            {docs.length} doc{docs.length === 1 ? '' : 's'} · {scopeLabel}
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => onStatus(e.target.value as DocStatus | '')}
          aria-label="Status"
          className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink"
        >
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="in-review">In review</option>
          <option value="published">Published</option>
        </select>
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as DocSort)}
          aria-label="Sort"
          className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink"
        >
          <option value="updated">Last updated</option>
          <option value="title">Title A–Z</option>
        </select>
      </header>

      <div
        role="group"
        aria-label="Filter by type"
        className="flex items-center gap-1 overflow-x-auto border-b border-line px-4 py-2 scroll-thin"
      >
        <KindChip on={!kind} onClick={() => onKind('')}>
          All types
        </KindChip>
        {kinds.map((k) => (
          <KindChip key={k} on={kind === k} onClick={() => onKind(kind === k ? '' : k)}>
            <DocKindIcon kind={k} className="h-3 w-3" /> {docKindMeta[k].label}
          </KindChip>
        ))}
      </div>

      {showTemplates && onTemplate && (
        <div className="border-b border-line px-4 py-3">
          <p className="mb-2 text-[12px] font-medium text-ink">Start from a template</p>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
            {kinds.map((k) => (
              <li key={k}>
                <button
                  onClick={() => onTemplate(k)}
                  className="flex w-full items-center gap-2 rounded-md border border-line bg-white px-2.5 py-2 text-left text-[12px] font-medium text-ink transition-colors duration-150 hover:border-line-strong hover:bg-sunken/40"
                >
                  <DocKindIcon kind={k} />
                  <span className="truncate">{docKindMeta[k].label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-16 text-center">
          <p className="text-[12.5px] text-muted">{emptyHint}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map((d) => {
            const open = d.comments.filter((c) => !c.resolved).length;
            const project = projects.find((p) => p.id === d.projectId);
            return (
              <li
                key={d.id}
                className="group grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 transition-colors duration-100 hover:bg-sunken/40 md:grid-cols-[24px_minmax(0,1fr)_84px_150px]"
              >
                <button
                  onClick={() => toggleStar(d.id)}
                  aria-label={isStarred(d.id) ? `Unstar ${d.title}` : `Star ${d.title}`}
                  className="rounded p-1 text-subtle hover:text-warn"
                >
                  <StarIcon
                    className={`h-3.5 w-3.5 ${isStarred(d.id) ? 'fill-warn text-warn' : ''}`}
                  />
                </button>
                <Link to={`/docs/${d.id}`} className="flex min-w-0 items-center gap-2.5">
                  <DocKindIcon kind={d.kind} className="h-4 w-4" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold text-ink group-hover:underline">
                      {d.title}
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-[11.5px] text-muted">
                      {project?.name} · {docKindMeta[d.kind].label} · v{d.versions.length}
                      {open > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-warn">
                          <MessageSquareIcon className="h-3 w-3" />
                          {open}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
                <span
                  className={`hidden w-fit rounded px-1.5 py-px text-[10.5px] font-semibold capitalize md:block ${statusTone[d.status]}`}
                >
                  {d.status.replace('-', ' ')}
                </span>
                <span className="flex items-center justify-end gap-1.5 text-[11.5px] text-muted">
                  <Avatar id={d.updatedBy} size="xs" />
                  <span className="hidden sm:inline">{firstName(d.updatedBy)} ·</span>{' '}
                  {relative(new Date(d.updatedAt))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function KindChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11.5px] font-medium transition-colors duration-100 ${on ? 'bg-ink text-white' : 'text-muted hover:bg-sunken hover:text-ink'}`}
    >
      {children}
    </button>
  );
}
