import { Link } from 'react-router-dom';
import { GitBranchIcon, GitPullRequestIcon, TagIcon } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { Sparkline } from '../../components/ui/Sparkline';
import { DataState, LoadMore, SampleDataBadge } from '../../components/engineering/states';
import { usePulls, useRepos } from '../../components/engineering/data/hooks';
import { useProductTab, textMatch } from '../../hooks/useProductTab';
import { ciMeta, firstName, reviewMeta } from '../../utils/status';
import { relative } from '../../utils/date';

/** Open PRs and repositories for one product, from the GitHub-backed API. */
export function ProductCode() {
  const { product, filters } = useProductTab();
  const pulls = usePulls({ state: 'open' });
  const repoList = useRepos({ product: product.id });

  const repos = repoList.items.filter(
    (r) => r.product === product.id && textMatch(filters.q, r.name, r.lastCommit?.message),
  );
  const prs = pulls.items.filter(
    (p) =>
      p.product === product.id &&
      p.state === 'open' &&
      textMatch(filters.q, p.number, p.title, p.taskKey, p.branch) &&
      (!filters.person || p.author === filters.person || p.reviewers.includes(filters.person)) &&
      (!filters.status || p.review === filters.status),
  );

  return (
    <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel
        title="Open pull requests"
        meta={
          <>
            <SampleDataBadge source={pulls.source} />
            {pulls.status === 'ready' && <span className="tabular-nums">{prs.length}</span>}
          </>
        }
      >
        {pulls.status !== 'ready' ? (
          <div className="p-2.5">
            <DataState
              status={pulls.status}
              error={pulls.error}
              what="Pull requests"
              github
              rows={3}
              onRetry={() => void pulls.reload()}
            />
          </div>
        ) : prs.length === 0 ? (
          <p className="px-3.5 py-4 text-[12.5px] text-muted">No open pull requests match.</p>
        ) : (
          <ul className="divide-y divide-line">
            {prs.map((p) => (
              <li key={`${p.repoId}#${p.number}`}>
                <Link
                  to={`/pull-requests/${p.number}?repo=${encodeURIComponent(p.repoId)}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-2 hover:bg-sunken/50 focus-visible:bg-sunken/50 md:grid-cols-[minmax(0,1fr)_110px_120px_96px_48px]"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                      <GitPullRequestIcon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                      <span className="truncate">
                        #{p.number} {p.title}
                      </span>
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted">
                      {p.repo} · {p.branch}
                      {p.taskKey ? ` · ${p.taskKey}` : ''}
                    </span>
                  </span>
                  <span className="hidden items-center gap-1.5 text-[12px] text-ink md:flex">
                    <Avatar id={p.author} size="xs" />
                    {firstName(p.author)}
                  </span>
                  <span className="hidden md:block">
                    <StatusBadge {...reviewMeta[p.review]} />
                  </span>
                  <StatusBadge {...ciMeta[p.ci]} dot />
                  <span className="hidden text-right text-[11.5px] tabular-nums text-muted md:block">
                    {relative(new Date(p.createdAt)).replace(/ ago$/, '')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <LoadMore hasMore={pulls.hasMore} loading={pulls.loadingMore} onClick={pulls.loadMore} />
      </Panel>
      <Panel
        title="Repositories"
        meta={
          <>
            <SampleDataBadge source={repoList.source} />
            {repoList.status === 'ready' && <span className="tabular-nums">{repos.length}</span>}
          </>
        }
      >
        {repoList.status !== 'ready' ? (
          <div className="p-2.5">
            <DataState
              status={repoList.status}
              error={repoList.error}
              what="Repositories"
              github
              rows={2}
              onRetry={() => void repoList.reload()}
            />
          </div>
        ) : repos.length === 0 ? (
          <p className="px-3.5 py-4 text-[12.5px] text-muted">
            No repositories linked to {product.name}.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {repos.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/repositories/${encodeURIComponent(r.id)}`}
                  className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3 px-3.5 py-2 hover:bg-sunken/50 focus-visible:bg-sunken/50"
                >
                  <span className="min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[12.5px] font-semibold text-ink">
                        {r.name}
                      </span>
                      <StatusBadge {...ciMeta[r.ci ?? 'none']} dot />
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted">
                      <GitBranchIcon className="h-3 w-3 shrink-0" aria-hidden /> {r.defaultBranch}
                      {r.latestTag && (
                        <>
                          {' · '}
                          <TagIcon className="h-3 w-3 shrink-0" aria-hidden /> {r.latestTag}
                        </>
                      )}
                      {r.openPrs !== undefined && ` · ${r.openPrs} PRs`}
                    </span>
                  </span>
                  {r.weeklyCommits && r.weeklyCommits.length > 1 ? (
                    <Sparkline
                      points={r.weeklyCommits}
                      width={72}
                      height={24}
                      label={`${r.name} weekly commits`}
                    />
                  ) : (
                    <span className="text-right text-[11px] text-subtle">—</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <LoadMore
          hasMore={repoList.hasMore}
          loading={repoList.loadingMore}
          onClick={repoList.loadMore}
        />
      </Panel>
    </div>
  );
}
