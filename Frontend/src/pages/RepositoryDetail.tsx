import { Link, useParams } from 'react-router-dom';
import {
  CircleCheckIcon,
  CircleXIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  TagIcon,
} from 'lucide-react';
import { DetailHeader } from '../components/ui/DetailHeader';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Sparkline } from '../components/ui/Sparkline';
import { NotFound } from '../components/ui/NotFound';
import { Person } from '../components/engineering/Person';
import { DataState, LoadMore, SampleDataBadge } from '../components/engineering/states';
import { ago, pullHref, safeHref } from '../components/engineering/format';
import { usePulls, useRepo } from '../components/engineering/data/hooks';
import { members, permissionMatrix } from '../data/team';
import { ciMeta, firstName, productById, reviewMeta } from '../utils/status';

export function RepositoryDetail() {
  // The router has already decoded the segment; it is the API's repo id.
  const { repoSlug: repoId = '' } = useParams();
  const res = useRepo(repoId);
  const pulls = usePulls({ repo: repoId, state: 'open' });

  if (res.status === 'not-found')
    return <NotFound what="Repository" backTo="/repositories" backLabel="Back to repositories" />;
  if (res.status !== 'ready' || !res.data)
    return (
      <div className="space-y-4">
        <DetailHeader
          crumbs={[{ label: 'Repositories', to: '/repositories' }, { label: repoId }]}
          title={<span className="font-mono">{repoId}</span>}
        />
        <DataState
          status={res.status}
          error={res.error}
          what="Repositories"
          github
          onRetry={res.reload}
        />
      </div>
    );

  const repo = res.data;
  const weeks = repo.weeklyCommits ?? [];
  const total = weeks.reduce((s, n) => s + n, 0);
  const protection = repo.branchProtection;
  const commits = repo.recentCommits ?? [];
  const access = members.filter((m) => m.status === 'active' && m.products.includes(repo.product));
  const href = safeHref(repo.url);
  const ci = repo.ci ?? 'none';

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[{ label: 'Repositories', to: '/repositories' }, { label: repo.name }]}
        leading={<ProductMark product={repo.product} size="lg" />}
        eyebrow={productById(repo.product).name}
        title={<span className="font-mono">{repo.name}</span>}
        badges={
          <>
            <StatusBadge {...ciMeta[ci]} dot />
            <span className="flex items-center gap-1 text-[12px] text-muted">
              <GitBranchIcon className="h-3 w-3" aria-hidden />
              {repo.defaultBranch}
            </span>
            {repo.latestTag && (
              <span className="flex items-center gap-1 text-[12px] text-muted">
                <TagIcon className="h-3 w-3" aria-hidden />
                {repo.latestTag}
              </span>
            )}
            {repo.language && <span className="text-[12px] text-muted">{repo.language}</span>}
            <SampleDataBadge source={repo.source} />
          </>
        }
        actions={
          href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[12.5px] font-medium text-ink hover:border-line-strong"
            >
              <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
              Open in GitHub
            </a>
          )
        }
      />

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
        <div className="bg-white px-3.5 py-2.5">
          <dt className="text-[11.5px] text-muted">Commits · {weeks.length || '—'} weeks</dt>
          <dd className="flex items-end justify-between gap-2">
            <span className="text-[18px] font-semibold tabular-nums text-ink">
              {weeks.length ? total : '—'}
            </span>
            {weeks.length > 1 && (
              <span className="h-6 w-20">
                <Sparkline points={weeks} width={80} height={24} label="Weekly commits" />
              </span>
            )}
          </dd>
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <dt className="text-[11.5px] text-muted">Open pull requests</dt>
          <dd className="text-[18px] font-semibold tabular-nums text-ink">
            {repo.openPrs ?? (pulls.status === 'ready' ? pulls.items.length : '—')}
          </dd>
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <dt className="text-[11.5px] text-muted">Members with access</dt>
          <dd className="text-[18px] font-semibold tabular-nums text-ink">{access.length}</dd>
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <dt className="text-[11.5px] text-muted">Branch protection</dt>
          <dd
            className={`text-[18px] font-semibold tabular-nums ${!protection ? 'text-ink' : protection.every((p) => p.ok) ? 'text-ok' : 'text-warn'}`}
          >
            {protection ? `${protection.filter((p) => p.ok).length}/${protection.length}` : '—'}
          </dd>
        </div>
      </dl>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="space-y-4">
          <Panel title="Recent commits" meta={<span>{repo.defaultBranch}</span>}>
            {commits.length === 0 ? (
              <p className="px-3.5 py-4 text-[12.5px] text-muted">No commits synced yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {commits.map((c) => (
                  <li key={c.sha} className="flex items-center gap-2.5 px-3.5 py-2 text-[12px]">
                    <span className="font-mono text-ink">{c.sha.slice(0, 7)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-muted">
                      {c.message}
                    </span>
                    <Person id={c.author} showName={false} />
                    <span className="w-16 text-right text-[11.5px] text-subtle">{ago(c.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel
            title="Open pull requests"
            meta={
              <>
                <SampleDataBadge source={pulls.source} />
                {pulls.status === 'ready' && <span>{pulls.items.length}</span>}
              </>
            }
          >
            {pulls.status !== 'ready' ? (
              <DataState
                status={pulls.status}
                error={pulls.error}
                what="Pull requests"
                github
                onRetry={pulls.reload}
                rows={2}
              />
            ) : pulls.items.length === 0 ? (
              <p className="px-3.5 py-4 text-[12.5px] text-muted">No open pull requests.</p>
            ) : (
              <ul className="divide-y divide-line">
                {pulls.items.map((p) => (
                  <li key={`${p.repoId}#${p.number}`}>
                    <Link
                      to={pullHref(p)}
                      className="flex items-center gap-2 px-3.5 py-2 hover:bg-sunken/50"
                    >
                      <span className="font-mono text-[11.5px] text-subtle">#{p.number}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                        {p.title}
                      </span>
                      <StatusBadge {...reviewMeta[p.review]} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <LoadMore
              hasMore={pulls.hasMore}
              loading={pulls.loadingMore}
              onClick={pulls.loadMore}
            />
          </Panel>
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Branch protection" meta={<span>{repo.defaultBranch}</span>}>
            {!protection ? (
              <p className="px-3.5 py-3 text-[12px] text-muted">
                Not reported by the server. Branch rules are managed in GitHub.
              </p>
            ) : (
              <>
                <ul className="space-y-2 px-3.5 py-3">
                  {protection.map((p) => (
                    <li key={p.label} className="flex items-start gap-2 text-[12.5px] text-ink">
                      {p.ok ? (
                        <CircleCheckIcon
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok"
                          aria-label="On"
                        />
                      ) : (
                        <CircleXIcon
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad"
                          aria-label="Off"
                        />
                      )}
                      {p.label}
                    </li>
                  ))}
                </ul>
                {!protection.every((p) => p.ok) && (
                  <p className="border-t border-line px-3.5 py-2.5 text-[12px] text-muted">
                    Change these in GitHub. TavetaHQ doesn’t request administration permissions.
                  </p>
                )}
              </>
            )}
          </Panel>
          <Panel title="Who can see this" meta={<span>via product access</span>}>
            <ul className="divide-y divide-line">
              {access.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/team/${m.id}`}
                    className="flex items-center gap-2 px-3.5 py-1.5 hover:bg-sunken/50"
                  >
                    <Avatar id={m.id} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                      {firstName(m.id)} <span className="text-muted">· {m.role}</span>
                    </span>
                    <span className="text-[11px] capitalize text-muted">
                      {permissionMatrix.Repository[m.role]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
