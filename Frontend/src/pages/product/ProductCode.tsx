import { Link } from 'react-router-dom';
import { GitBranchIcon, GitPullRequestIcon, TagIcon } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { Sparkline } from '../../components/ui/Sparkline';
import { useProductTab, textMatch } from '../../hooks/useProductTab';
import { pullRequests, repositories } from '../../data/engineering';
import { ciMeta, firstName, reviewMeta } from '../../utils/status';
import { repoSlug } from '../../utils/slug';

export function ProductCode() {
  const { product, filters } = useProductTab();
  const repos = repositories.filter(
    (r) => r.product === product.id && textMatch(filters.q, r.name, r.lastCommit.message),
  );
  const prs = pullRequests.filter(
    (p) =>
      p.product === product.id &&
      p.review !== 'merged' &&
      textMatch(filters.q, p.number, p.title, p.taskKey, p.branch) &&
      (!filters.person || p.author === filters.person || p.reviewers.includes(filters.person)) &&
      (!filters.status || p.review === filters.status),
  );

  return (
    <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="Open pull requests" meta={<span className="tabular-nums">{prs.length}</span>}>
        {prs.length === 0 ? (
          <p className="px-3.5 py-4 text-[12.5px] text-muted">No open pull requests match.</p>
        ) : (
          <ul className="divide-y divide-line">
            {prs.map((p) => (
              <li key={p.number}>
                <Link
                  to={`/pull-requests/${p.number}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-2 hover:bg-sunken/50 md:grid-cols-[minmax(0,1fr)_110px_120px_96px_48px]"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                      <GitPullRequestIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="truncate">
                        #{p.number} {p.title}
                      </span>
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted">
                      {p.branch}
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
                    {p.age}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Repositories" meta={<span className="tabular-nums">{repos.length}</span>}>
        <ul className="divide-y divide-line">
          {repos.map((r) => (
            <li key={r.name}>
              <Link
                to={`/repositories/${repoSlug(r.name)}`}
                className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3 px-3.5 py-2 hover:bg-sunken/50"
              >
                <span className="min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[12.5px] font-semibold text-ink">
                      {r.name}
                    </span>
                    <StatusBadge {...ciMeta[r.ci]} dot />
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted">
                    <GitBranchIcon className="h-3 w-3 shrink-0" /> {r.defaultBranch} ·{' '}
                    <TagIcon className="h-3 w-3 shrink-0" /> {r.latestTag} · {r.openPrs} PRs
                  </span>
                </span>
                <Sparkline
                  points={r.weeklyCommits}
                  width={72}
                  height={24}
                  label={`${r.name} weekly commits`}
                />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
