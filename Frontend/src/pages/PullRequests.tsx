import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GitBranchIcon, XIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Segmented } from '../components/ui/Segmented';
import { ProductMark } from '../components/ui/ProductMark';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Person } from '../components/engineering/Person';
import { DataState, LoadMore, SampleDataBadge } from '../components/engineering/states';
import { ago, pullHref } from '../components/engineering/format';
import { usePulls } from '../components/engineering/data/hooks';
import type { ApiPull } from '../components/engineering/data/types';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { ciMeta, reviewMeta } from '../utils/status';

type Filter = 'open' | 'review' | 'changes' | 'ci' | 'merged';

const filters: Record<Filter, (p: ApiPull) => boolean> = {
  open: (p) => p.state === 'open',
  review: (p) => p.state === 'open' && p.review === 'review-required',
  changes: (p) => p.state === 'open' && p.review === 'changes-requested',
  ci: (p) => p.state === 'open' && p.ci === 'failing',
  merged: (p) => p.state === 'merged',
};

export function PullRequests() {
  const { matches } = useProductFilter();
  const { openTask } = useWorkspaceUI();
  const [params, setParams] = useSearchParams();
  const repo = params.get('repo') ?? undefined;
  const [filter, setFilter] = useState<Filter>('open');
  const list = usePulls({ repo, state: filter === 'merged' ? 'merged' : 'open' });

  const scoped = useMemo(() => list.items.filter((p) => matches(p.product)), [list.items, matches]);
  const rows = useMemo(() => scoped.filter(filters[filter]), [scoped, filter]);

  const reviewLoad = useMemo(() => {
    const counts = new Map<string, number>();
    scoped
      .filter(filters.review)
      .forEach((p) => p.reviewers.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  const count = (f: Filter) =>
    (filter === 'merged') === (f === 'merged') ? scoped.filter(filters[f]).length : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pull requests"
        description="Synchronized from GitHub. DevHQ links each change to its task; GitHub stays authoritative for merges."
        actions={<SampleDataBadge source={list.source} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Filter>
          label="Filter pull requests"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'All open', count: count('open') },
            { value: 'review', label: 'Needs review', count: count('review') },
            { value: 'changes', label: 'Changes requested', count: count('changes') },
            { value: 'ci', label: 'CI failing', count: count('ci') },
            { value: 'merged', label: 'Merged', count: count('merged') },
          ]}
        />
        {repo && (
          <button
            onClick={() => {
              params.delete('repo');
              setParams(params, { replace: true });
            }}
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-soft px-2 py-1 font-mono text-[11.5px] text-accent-ink"
            aria-label={`Clear repository filter ${repo}`}
          >
            {repo} <XIcon className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface">
          {list.status !== 'ready' ? (
            <DataState
              status={list.status}
              error={list.error}
              what="Pull requests"
              github
              onRetry={list.reload}
            />
          ) : rows.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted">
              No pull requests in this view.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <caption className="sr-only">Pull requests, {filter} view</caption>
                <thead className="border-b border-line bg-sunken/40 text-[11px] font-medium text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-1.5 font-medium">
                      Pull request
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Author
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      CI
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Review
                    </th>
                    <th scope="col" className="px-4 py-1.5 text-right font-medium">
                      Opened
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((p) => (
                    <tr key={`${p.repoId}#${p.number}`} className="align-top hover:bg-sunken/30">
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <ProductMark product={p.product} size="sm" />
                          <span className="font-mono text-subtle">#{p.number}</span>
                          <Link
                            to={pullHref(p)}
                            className="truncate text-sm font-semibold text-ink hover:underline"
                          >
                            {p.title}
                          </Link>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                          <span className="font-mono">{p.repo}</span>
                          <span className="flex items-center gap-1 font-mono">
                            <GitBranchIcon className="h-3 w-3" aria-hidden />
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
                          {p.additions !== undefined && p.deletions !== undefined && (
                            <span>
                              <span className="text-ok">+{p.additions}</span>{' '}
                              <span className="text-bad">−{p.deletions}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <Person id={p.author} showName={false} />
                      </td>
                      <td className="px-2 py-3">
                        <StatusBadge {...ciMeta[p.ci]} dot />
                      </td>
                      <td className="px-2 py-3">
                        <StatusBadge {...reviewMeta[p.review]} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-subtle">
                        {ago(p.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
        </div>

        <div className="grid content-start gap-5 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Review load" meta={<span>From loaded PRs</span>}>
            <ul className="space-y-3 px-4 py-3.5">
              {reviewLoad.map(([id, n]) => (
                <li key={id} className="flex items-center gap-2.5 text-sm text-ink">
                  <span className="min-w-0 flex-1 truncate">
                    <Person id={id} />
                  </span>
                  <span className="font-mono text-xs text-muted">{n} waiting</span>
                </li>
              ))}
              {reviewLoad.length === 0 && (
                <li className="text-sm text-muted">
                  {list.status === 'ready' ? 'No reviews waiting.' : '—'}
                </li>
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
