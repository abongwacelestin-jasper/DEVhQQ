import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitBranchIcon, RefreshCwIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Segmented } from '../components/ui/Segmented';
import { ProductMark } from '../components/ui/ProductMark';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Avatar } from '../components/ui/Avatar';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { pullRequests } from '../data/engineering';
import { members } from '../data/team';
import { ciMeta, reviewMeta } from '../utils/status';
import type { PullRequest } from '../types/engineering';

type Filter = 'open' | 'review' | 'changes' | 'ci' | 'merged';

const filters: Record<Filter, (p: PullRequest) => boolean> = {
  open: (p) => p.review !== 'merged',
  review: (p) => p.review === 'review-required',
  changes: (p) => p.review === 'changes-requested',
  ci: (p) => p.ci === 'failing',
  merged: (p) => p.review === 'merged',
};

export function PullRequests() {
  const { matches } = useProductFilter();
  const { openTask } = useWorkspaceUI();
  const [filter, setFilter] = useState<Filter>('open');
  const scoped = pullRequests.filter((p) => matches(p.product));
  const rows = useMemo(() => scoped.filter(filters[filter]), [scoped, filter]);

  const reviewLoad = members
    .map((m) => ({
      m,
      n: scoped.filter((p) => p.review === 'review-required' && p.reviewers.includes(m.id)).length,
    }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pull requests"
        description="Synchronized from GitHub. DevHQ links each change to its task; GitHub stays authoritative for reviews and merges."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-muted">
            <RefreshCwIcon className="h-3.5 w-3.5" /> GitHub App · synced 2m ago
          </span>
        }
      />

      <Segmented<Filter>
        label="Filter pull requests"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: 'All open', count: scoped.filter(filters.open).length },
          { value: 'review', label: 'Needs review', count: scoped.filter(filters.review).length },
          {
            value: 'changes',
            label: 'Changes requested',
            count: scoped.filter(filters.changes).length,
          },
          { value: 'ci', label: 'CI failing', count: scoped.filter(filters.ci).length },
          { value: 'merged', label: 'Merged', count: scoped.filter(filters.merged).length },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface">
          {rows.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted">
              No pull requests in this view.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((p) => (
                <li
                  key={p.number}
                  className="grid gap-3 px-4 py-3.5 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ProductMark product={p.product} size="sm" />
                      <span className="font-mono text-xs text-subtle">#{p.number}</span>
                      <Link
                        to={`/pull-requests/${p.number}`}
                        className="truncate text-sm font-semibold text-ink hover:underline"
                      >
                        {p.title}
                      </Link>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span className="font-mono">{p.repo}</span>
                      <span className="flex items-center gap-1 font-mono">
                        <GitBranchIcon className="h-3 w-3" />
                        {p.branch}
                      </span>
                      {p.taskKey ? (
                        <button
                          onClick={() => openTask(p.taskKey ?? null)}
                          className="rounded bg-accent-soft px-1.5 font-mono font-medium text-accent-ink hover:underline"
                        >
                          {p.taskKey}
                        </button>
                      ) : (
                        <span className="rounded bg-warn-soft px-1.5 text-warn">
                          No linked task
                        </span>
                      )}
                      <span>
                        <span className="text-ok">+{p.additions}</span>{' '}
                        <span className="text-bad">−{p.deletions}</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <Avatar id={p.author} size="sm" />
                    <span className="text-line-strong">→</span>
                    <div className="flex -space-x-1.5">
                      {p.reviewers.map((r) => (
                        <Avatar key={r} id={r} size="sm" ring />
                      ))}
                    </div>
                    <StatusBadge {...ciMeta[p.ci]} dot />
                    <StatusBadge {...reviewMeta[p.review]} />
                    <span className="w-8 text-right text-xs text-subtle">{p.age}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid content-start gap-5 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Review load" meta={<span>Derived</span>}>
            <ul className="space-y-3 px-4 py-3.5">
              {reviewLoad.map(({ m, n }) => (
                <li key={m.id} className="flex items-center gap-2.5">
                  <Avatar id={m.id} size="sm" />
                  <span className="flex-1 truncate text-sm text-ink">{m.name}</span>
                  <span className="font-mono text-xs text-muted">{n} waiting</span>
                </li>
              ))}
              {reviewLoad.length === 0 && (
                <li className="text-sm text-muted">No reviews waiting.</li>
              )}
            </ul>
          </Panel>
          <div className="rounded-xl border border-dashed border-line-strong px-4 py-3.5 text-xs leading-relaxed text-muted">
            <p className="font-semibold text-ink">Workflow rule</p>
            When a linked PR merges, its task moves to{' '}
            <span className="font-medium text-ink">Ready to release</span> — not Done. Done requires
            a successful production deploy.
          </div>
        </div>
      </div>
    </div>
  );
}
