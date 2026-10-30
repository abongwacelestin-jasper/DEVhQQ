import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowDownUpIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  UnplugIcon,
  WebhookIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { GitHubAppPanel } from '../components/engineering/GitHubAppPanel';
import { GitHubAppModal } from '../components/engineering/GitHubAppModal';
import { RepoTrend } from '../components/engineering/RepoTrend';
import { CiPill } from '../components/engineering/CiPill';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useAuth } from '../contexts/AuthContext';
import { useReauth } from '../contexts/ReauthContext';
import { useGitHubApp } from '../hooks/useGitHubApp';
import { integrationConfigs } from '../data/security';
import { repoSlug } from '../utils/slug';
import { firstName, productById } from '../utils/status';
import type { CiStatus, Repository } from '../types/engineering';

type Sort = 'activity' | 'name' | 'recent';
const ciFilters: { value: CiStatus | ''; label: string }[] = [
  { value: '', label: 'Any CI status' },
  { value: 'passing', label: 'Passing' },
  { value: 'failing', label: 'Failing' },
  { value: 'running', label: 'Running' },
];

/** "3h" / "12m" / "2d" → minutes, for recency sorting. */
const agoMinutes = (s: string) => {
  const m = /^(\d+)([mhd])/.exec(s);
  if (!m) return s === 'now' ? 0 : 1e9;
  return Number(m[1]) * (m[2] === 'm' ? 1 : m[2] === 'h' ? 60 : 1440);
};
const total = (r: Repository) => r.weeklyCommits.reduce((s, n) => s + n, 0);

export function Repositories() {
  const { matches } = useProductFilter();
  const { canDo, log } = useAuth();
  const { requestReauth } = useReauth();
  const { installation, setInstallation, repos, connect, disconnect } = useGitHubApp();
  const [configOpen, setConfigOpen] = useState(false);
  const [q, setQ] = useState('');
  const [ci, setCi] = useState<CiStatus | ''>('');
  const [sort, setSort] = useState<Sort>('activity');
  const admin = canDo('workspace:delete') || canDo('member:invite');

  const scoped = repos.filter((r) => matches(r.product));
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = scoped.filter(
      (r) =>
        (!ci || r.ci === ci) &&
        (!needle ||
          `${r.name} ${r.language} ${r.lastCommit.message}`.toLowerCase().includes(needle)),
    );
    const cmp: Record<Sort, (a: Repository, b: Repository) => number> = {
      activity: (a, b) => total(b) - total(a),
      name: (a, b) => a.name.localeCompare(b.name),
      recent: (a, b) => agoMinutes(a.lastCommit.ago) - agoMinutes(b.lastCommit.ago),
    };
    return [...list].sort(cmp[sort]);
  }, [scoped, q, ci, sort]);

  const github = integrationConfigs.find((i) => i.webhook?.url.includes('/github/'));
  const deliveries = github?.deliveries ?? [];
  const deliveryRate = deliveries.length
    ? Math.round((deliveries.filter((d) => d.status < 300).length / deliveries.length) * 1000) / 10
    : null;
  const openPrs = scoped.reduce((n, r) => n + r.openPrs, 0);
  const failing = scoped.filter((r) => r.ci === 'failing').length;

  const remove = (name: string) =>
    requestReauth({
      title: `Disconnect ${name}`,
      description: 'DevHQ stops syncing this repository. History already linked to tasks is kept.',
      actionLabel: 'Verify & disconnect',
      onConfirm: () => {
        disconnect(name);
        log('Disconnected repository', name, true);
        toast(`${name} disconnected`);
      },
    });

  const summary = [
    {
      label: 'Connected repos',
      value: scoped.length,
      sub: `${scoped.filter((r) => r.ci !== 'none').length} with CI`,
    },
    {
      label: 'Webhook delivery',
      value: deliveryRate === null ? '—' : `${deliveryRate}%`,
      sub: `${deliveries.length} deliveries · 24h`,
      tone: deliveryRate !== null && deliveryRate < 99 ? 'warn' : 'ok',
    },
    {
      label: 'Open pull requests',
      value: openPrs,
      sub: `across ${scoped.filter((r) => r.openPrs).length} repos`,
      to: '/pull-requests',
    },
    {
      label: 'CI failing',
      value: failing,
      sub: failing ? 'needs attention' : 'all green',
      tone: failing ? 'bad' : 'ok',
    },
  ] as const;

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Repositories"
        description="Connected through the GitHub App. Read-only code activity, scoped to each member’s product access."
        actions={
          admin && (
            <Button
              variant="primary"
              size="sm"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => setConfigOpen(true)}
            >
              Connect repository
            </Button>
          )
        }
      />

      {/* Health summary */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
        {summary.map((s) => {
          const body = (
            <>
              <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                {s.label === 'Webhook delivery' && <WebhookIcon className="h-3 w-3" />}
                {s.label}
              </dt>
              <dd
                className={`mt-0.5 text-[18px] font-semibold leading-6 tabular-nums ${'tone' in s && s.tone === 'bad' ? 'text-bad' : 'tone' in s && s.tone === 'warn' ? 'text-warn' : 'text-ink'}`}
              >
                {s.value}
              </dd>
              <dd className="truncate text-[11px] text-subtle">{s.sub}</dd>
            </>
          );

          return 'to' in s ? (
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

      <GitHubAppPanel
        installation={installation}
        repoCount={repos.length}
        onConfigure={() => setConfigOpen(true)}
        onChange={setInstallation}
      />

      {/* Filter toolbar */}
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
          onChange={(e) => setCi(e.target.value as CiStatus | '')}
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
          <ArrowDownUpIcon className="h-3.5 w-3.5" />
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
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted">
          {rows.length} of {scoped.length}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((r) => {
          const sum = total(r);
          const last = r.weeklyCommits[r.weeklyCommits.length - 1];
          const prev = r.weeklyCommits[r.weeklyCommits.length - 2] ?? last;
          const delta = prev ? Math.round(((last - prev) / prev) * 100) : 0;
          return (
            <article
              key={r.name}
              className="grid grid-rows-[auto_auto_auto_1fr] rounded-lg border border-line bg-white"
            >
              <header className="flex items-start gap-2.5 px-3.5 pt-3">
                <ProductMark product={r.product} size="md" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-mono text-[12.5px] font-semibold leading-5 text-ink">
                    <Link to={`/repositories/${repoSlug(r.name)}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                    <span className="mr-0.5">{productById(r.product).name}</span>
                    <Tag icon={<GitBranchIcon className="h-3 w-3" />}>{r.defaultBranch}</Tag>
                    <Tag icon={<TagIcon className="h-3 w-3" />}>{r.latestTag}</Tag>
                    <Tag>{r.language}</Tag>
                  </p>
                </div>
                <CiPill ci={r.ci} />
              </header>

              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 px-3.5 pt-3">
                <div className="min-w-0">
                  <p className="text-[10.5px] text-subtle">Commits · 8 weeks</p>
                  <div className="mt-1 rounded-md bg-sunken/40 px-1.5 py-1">
                    <RepoTrend
                      points={r.weeklyCommits}
                      tone={r.ci === 'failing' ? 'bad' : 'accent'}
                      label={`${sum} commits in 8 weeks`}
                    />
                  </div>
                </div>
                <div className="pb-1 text-right">
                  <p className="text-[20px] font-semibold leading-6 tabular-nums text-ink">{sum}</p>
                  <p className="text-[11px] text-subtle">commits</p>
                  <p
                    className={`text-[10.5px] font-medium tabular-nums ${delta >= 0 ? 'text-ok' : 'text-bad'}`}
                  >
                    {delta >= 0 ? '+' : ''}
                    {delta}% wk
                  </p>
                </div>
              </div>

              <div className="mx-3.5 mt-3 flex min-w-0 items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[11.5px]">
                <GitCommitHorizontalIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />
                <span className="shrink-0 font-mono text-ink">{r.lastCommit.sha}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted">
                  {r.lastCommit.message}
                </span>
              </div>

              <footer className="mt-3 flex items-center gap-2 self-end border-t border-line px-3.5 py-2 text-[11.5px] text-muted">
                <Avatar id={r.lastCommit.author} size="xs" />
                <span className="truncate">
                  {firstName(r.lastCommit.author)} · {r.lastCommit.ago}
                </span>
                <Link
                  to="/pull-requests"
                  className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-sunken hover:text-ink ${r.openPrs ? 'font-medium text-ink' : ''}`}
                >
                  <GitPullRequestIcon className="h-3.5 w-3.5" /> {r.openPrs} open
                </Link>
                {admin && (
                  <button
                    onClick={() => remove(r.name)}
                    aria-label={`Disconnect ${r.name}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-bad-soft hover:text-bad"
                  >
                    <UnplugIcon className="h-3.5 w-3.5" />{' '}
                    <span className="hidden sm:inline">Disconnect</span>
                  </button>
                )}
              </footer>
            </article>
          );
        })}
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-[12.5px] text-muted md:col-span-2 2xl:col-span-3">
            No repositories match these filters.
          </p>
        )}
      </div>

      <GitHubAppModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        installation={installation}
        connected={repos.map((r) => r.name)}
        onSave={(inst, add) => {
          setInstallation(inst);
          if (add.length) connect(add);
        }}
      />
    </div>
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
