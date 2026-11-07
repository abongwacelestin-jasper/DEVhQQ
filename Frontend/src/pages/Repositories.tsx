import React, { Suspense, lazy, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownUpIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { ProductMark } from '../components/ui/ProductMark';
import { GitHubAppPanel } from '../components/engineering/GitHubAppPanel';
import { RepoTrend } from '../components/engineering/RepoTrend';
import { CiPill } from '../components/engineering/CiPill';
import { Person } from '../components/engineering/Person';
import {
  DataState,
  GuardedButton,
  LoadMore,
  SampleDataBadge,
} from '../components/engineering/states';
import { ago } from '../components/engineering/format';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useAuth } from '../contexts/AuthContext';
import { useGitHubApp } from '../hooks/useGitHubApp';
import { productById } from '../utils/status';
import type { ApiCiState, ApiRepo } from '../components/engineering/data/types';

// The link dialog is only needed by managers, and only once opened.
const GitHubAppModal = lazy(() =>
  import('../components/engineering/GitHubAppModal').then((m) => ({ default: m.GitHubAppModal })),
);

type Sort = 'activity' | 'name' | 'recent';
const ciFilters: { value: ApiCiState | ''; label: string }[] = [
  { value: '', label: 'Any CI status' },
  { value: 'passing', label: 'Passing' },
  { value: 'failing', label: 'Failing' },
  { value: 'running', label: 'Running' },
];

const total = (r: ApiRepo) => (r.weeklyCommits ?? []).reduce((s, n) => s + n, 0);
const lastAt = (r: ApiRepo) => (r.lastCommit ? new Date(r.lastCommit.at).getTime() : 0);

export function Repositories() {
  const { matches } = useProductFilter();
  const { canDo } = useAuth();
  const { app, repoList } = useGitHubApp();
  const [linkOpen, setLinkOpen] = useState(false);
  const [q, setQ] = useState('');
  const [ci, setCi] = useState<ApiCiState | ''>('');
  const [sort, setSort] = useState<Sort>('activity');
  const canManage = canDo('github:configure');

  const scoped = useMemo(
    () => repoList.items.filter((r) => matches(r.product)),
    [repoList.items, matches],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = scoped.filter(
      (r) =>
        (!ci || (r.ci ?? 'none') === ci) &&
        (!needle ||
          `${r.name} ${r.language ?? ''} ${r.lastCommit?.message ?? ''}`
            .toLowerCase()
            .includes(needle)),
    );
    const cmp: Record<Sort, (a: ApiRepo, b: ApiRepo) => number> = {
      activity: (a, b) => total(b) - total(a),
      name: (a, b) => a.name.localeCompare(b.name),
      recent: (a, b) => lastAt(b) - lastAt(a),
    };
    return [...list].sort(cmp[sort]);
  }, [scoped, q, ci, sort]);

  // Only figures the server sent are summed; a repo without the field adds nothing and is counted as unknown.
  const withPrs = scoped.filter((r) => r.openPrs !== undefined);
  const openPrs = withPrs.reduce((n, r) => n + (r.openPrs ?? 0), 0);
  const failing = scoped.filter((r) => r.ci === 'failing').length;

  const summary: {
    label: string;
    value: React.ReactNode;
    sub: string;
    tone?: 'bad' | 'ok';
    to?: string;
  }[] = [
    {
      label: 'Linked repos',
      value: scoped.length,
      sub: `${scoped.filter((r) => r.ci && r.ci !== 'none').length} with CI`,
    },
    {
      label: 'Open pull requests',
      value: withPrs.length ? openPrs : '—',
      sub: `across ${scoped.filter((r) => r.openPrs).length} repos`,
      to: '/pull-requests',
    },
    {
      label: 'CI failing',
      value: failing,
      sub: failing ? 'needs attention' : 'all green',
      tone: failing ? 'bad' : 'ok',
    },
  ];

  const ready = repoList.status === 'ready';

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Repositories"
        description="Linked through the GitHub App. Read-only code activity, scoped to each member’s product access."
        actions={
          <>
            <SampleDataBadge source={repoList.source} />
            {ready && (
              <GuardedButton
                allowed={canManage}
                reason="Needs Repository: manage — ask an Owner"
                variant="primary"
                size="sm"
                icon={<PlusIcon className="h-3.5 w-3.5" />}
                onClick={() => setLinkOpen(true)}
              >
                Link repository
              </GuardedButton>
            )}
          </>
        }
      />

      <GitHubAppPanel
        app={app}
        repoCount={repoList.items.length}
        onLink={() => setLinkOpen(true)}
      />

      {!ready ? (
        <DataState
          status={repoList.status}
          error={repoList.error}
          what="Repositories"
          github
          onRetry={repoList.reload}
        />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
            {summary.map((s) => {
              const body = (
                <>
                  <dt className="text-[11px] font-medium text-muted">{s.label}</dt>
                  <dd
                    className={`mt-0.5 text-[18px] font-semibold leading-6 tabular-nums ${s.tone === 'bad' ? 'text-bad' : 'text-ink'}`}
                  >
                    {s.value}
                  </dd>
                  <dd className="truncate text-[11px] text-subtle">{s.sub}</dd>
                </>
              );
              return s.to ? (
                <Link
                  key={s.label}
                  to={s.to}
                  className="block min-w-0 bg-white px-3.5 py-2.5 transition-colors duration-150 hover:bg-sunken/50"
                >
                  {body}
                </Link>
              ) : (
                <div key={s.label} className="min-w-0 bg-white px-3.5 py-2.5">
                  {body}
                </div>
              );
            })}
          </dl>

          <div className="flex flex-wrap items-center gap-1.5">
            <label className="relative block w-full sm:w-64">
              <span className="sr-only">Search repositories</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, language, commit"
                className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-2 text-[12.5px] outline-none focus:border-accent"
              />
            </label>
            <select
              value={ci}
              onChange={(e) => setCi(e.target.value as ApiCiState | '')}
              aria-label="Filter by CI status"
              className={`h-8 rounded-md border bg-white px-2 text-[12.5px] ${ci ? 'border-accent/40 text-accent-ink' : 'border-line text-ink'}`}
            >
              {ciFilters.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <label className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white pl-2 text-[12.5px] text-muted">
              <ArrowDownUpIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-full rounded-md bg-transparent pr-1.5 text-ink outline-none"
              >
                <option value="activity">Commit activity</option>
                <option value="recent">Recently updated</option>
                <option value="name">Name</option>
              </select>
            </label>
            {(q || ci) && (
              <button
                onClick={() => {
                  setQ('');
                  setCi('');
                }}
                className="px-1 text-[12px] font-medium text-accent hover:underline"
              >
                Reset
              </button>
            )}
            <span
              className="ml-auto shrink-0 text-[12px] tabular-nums text-muted"
              aria-live="polite"
            >
              {rows.length} of {scoped.length}
            </span>
          </div>

          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="Repositories">
            {rows.map((r) => (
              <RepoCard key={r.id} r={r} />
            ))}
            {rows.length === 0 && (
              <li className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-[12.5px] text-muted md:col-span-2 2xl:col-span-3">
                {scoped.length
                  ? 'No repositories match these filters.'
                  : 'No repositories are linked yet.'}
              </li>
            )}
          </ul>
          <LoadMore
            hasMore={repoList.hasMore}
            loading={repoList.loadingMore}
            onClick={repoList.loadMore}
          />
        </>
      )}

      {linkOpen && (
        <Suspense fallback={null}>
          <GitHubAppModal
            open={linkOpen}
            onClose={() => setLinkOpen(false)}
            onLink={repoList.link}
          />
        </Suspense>
      )}
    </div>
  );
}

function RepoCard({ r }: { r: ApiRepo }) {
  const weeks = r.weeklyCommits ?? [];
  const sum = total(r);
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  const delta = prev ? Math.round(((last - prev) / prev) * 100) : null;
  return (
    <li className="grid grid-rows-[auto_auto_auto_1fr] rounded-lg border border-line bg-white">
      <header className="flex items-start gap-2.5 px-3.5 pt-3">
        <ProductMark product={r.product} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[12.5px] font-semibold leading-5 text-ink">
            <Link to={`/repositories/${encodeURIComponent(r.id)}`} className="hover:underline">
              {r.name}
            </Link>
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
            <span className="mr-0.5">{productById(r.product).name}</span>
            <Tag icon={<GitBranchIcon className="h-3 w-3" />}>{r.defaultBranch}</Tag>
            {r.latestTag && <Tag icon={<TagIcon className="h-3 w-3" />}>{r.latestTag}</Tag>}
            {r.language && <Tag>{r.language}</Tag>}
          </p>
        </div>
        <CiPill ci={r.ci ?? 'none'} />
      </header>

      {weeks.length > 1 ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 px-3.5 pt-3">
          <div className="min-w-0">
            <p className="text-[10.5px] text-subtle">Commits · {weeks.length} weeks</p>
            <div className="mt-1 rounded-md bg-sunken/40 px-1.5 py-1">
              <RepoTrend
                points={weeks}
                tone={r.ci === 'failing' ? 'bad' : 'accent'}
                label={`${sum} commits in ${weeks.length} weeks`}
              />
            </div>
          </div>
          <div className="pb-1 text-right">
            <p className="text-[20px] font-semibold leading-6 tabular-nums text-ink">{sum}</p>
            <p className="text-[11px] text-subtle">commits</p>
            {delta !== null && (
              <p
                className={`text-[10.5px] font-medium tabular-nums ${delta >= 0 ? 'text-ok' : 'text-bad'}`}
              >
                {delta >= 0 ? '+' : ''}
                {delta}% wk
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="px-3.5 pt-3 text-[11.5px] text-subtle">No commit history synced yet.</p>
      )}

      <div className="mx-3.5 mt-3 flex min-w-0 items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[11.5px]">
        <GitCommitHorizontalIcon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
        <span className="shrink-0 font-mono text-ink">{r.lastCommit?.sha.slice(0, 7) ?? '—'}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted">
          {r.lastCommit?.message ?? 'No commits synced'}
        </span>
      </div>

      <footer className="mt-3 flex items-center gap-2 self-end border-t border-line px-3.5 py-2 text-[11.5px] text-muted">
        {r.lastCommit ? (
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <Person id={r.lastCommit.author} link={false} /> · {ago(r.lastCommit.at)}
          </span>
        ) : (
          <span>—</span>
        )}
        <Link
          to={`/pull-requests?repo=${encodeURIComponent(r.id)}`}
          className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-sunken hover:text-ink ${r.openPrs ? 'font-medium text-ink' : ''}`}
        >
          <GitPullRequestIcon className="h-3.5 w-3.5" aria-hidden />{' '}
          {r.openPrs === undefined ? 'Pull requests' : `${r.openPrs} open`}
        </Link>
      </footer>
    </li>
  );
}

function Tag({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line bg-sunken/50 px-1.5 py-px font-mono text-[10.5px] text-ink">
      {icon}
      {children}
    </span>
  );
}
