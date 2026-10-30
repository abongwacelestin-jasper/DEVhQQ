import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BadgeCheckIcon,
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
import { Button } from '../components/ui/Button';
import { NotFound } from '../components/ui/NotFound';
import { branchProtection, commits, pullRequests, repositories } from '../data/engineering';
import { members, permissionMatrix } from '../data/team';
import { ciMeta, firstName, productById, reviewMeta, toneDot } from '../utils/status';
import { repoFromSlug } from '../utils/slug';

export function RepositoryDetail() {
  const { repoSlug = '' } = useParams();
  const repo = repositories.find((r) => r.name === repoFromSlug(repoSlug));
  if (!repo)
    return <NotFound what="Repository" backTo="/repositories" backLabel="Back to repositories" />;

  const repoCommits = commits.filter((c) => c.repo === repo.name);
  const prs = pullRequests.filter((p) => p.repo === repo.name);
  const protection = branchProtection[repo.name] ?? [];
  const access = members.filter((m) => m.status === 'active' && m.products.includes(repo.product));
  const total = repo.weeklyCommits.reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[{ label: 'Repositories', to: '/repositories' }, { label: repo.name }]}
        leading={<ProductMark product={repo.product} size="lg" />}
        eyebrow={productById(repo.product).name}
        title={<span className="font-mono">{repo.name}</span>}
        badges={
          <>
            <StatusBadge {...ciMeta[repo.ci]} dot />
            <span className="flex items-center gap-1 text-[12px] text-muted">
              <GitBranchIcon className="h-3 w-3" />
              {repo.defaultBranch}
            </span>
            <span className="flex items-center gap-1 text-[12px] text-muted">
              <TagIcon className="h-3 w-3" />
              {repo.latestTag}
            </span>
            <span className="text-[12px] text-muted">{repo.language}</span>
          </>
        }
        actions={
          <Button
            icon={<ExternalLinkIcon className="h-3.5 w-3.5" />}
            onClick={() => toast('Opening GitHub', { description: `github.com/${repo.name}` })}
          >
            Open in GitHub
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
        <div className="bg-white px-3.5 py-2.5">
          <p className="text-[11.5px] text-muted">Commits · 8 weeks</p>
          <div className="flex items-end justify-between gap-2">
            <p className="text-[18px] font-semibold tabular-nums text-ink">{total}</p>
            <div className="h-6 w-20">
              <Sparkline
                points={repo.weeklyCommits}
                width={80}
                height={24}
                label="Weekly commits"
              />
            </div>
          </div>
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <p className="text-[11.5px] text-muted">Open pull requests</p>
          <p className="text-[18px] font-semibold tabular-nums text-ink">{repo.openPrs}</p>
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <p className="text-[11.5px] text-muted">Members with access</p>
          <p className="text-[18px] font-semibold tabular-nums text-ink">{access.length}</p>
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <p className="text-[11.5px] text-muted">Branch protection</p>
          <p
            className={`text-[18px] font-semibold tabular-nums ${protection.every((p) => p.ok) ? 'text-ok' : 'text-warn'}`}
          >
            {protection.filter((p) => p.ok).length}/{protection.length}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="space-y-4">
          <Panel title="Recent commits" meta={<span>{repo.defaultBranch}</span>}>
            <ul className="divide-y divide-line">
              {repoCommits.map((c) => (
                <li key={c.sha} className="flex items-center gap-2.5 px-3.5 py-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[ciMeta[c.ci].tone]}`}
                    title={ciMeta[c.ci].label}
                  />
                  <span className="font-mono text-[12px] text-ink">{c.sha}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
                    {c.message}
                  </span>
                  {c.signed ? (
                    <span className="hidden items-center gap-0.5 text-[11px] font-medium text-ok sm:inline-flex">
                      <BadgeCheckIcon className="h-3 w-3" />
                      Verified
                    </span>
                  ) : (
                    <span className="hidden text-[11px] font-medium text-warn sm:inline">
                      Unsigned
                    </span>
                  )}
                  <Avatar id={c.author} size="xs" />
                  <span className="w-8 text-right text-[11.5px] text-subtle">{c.ago}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Pull requests" meta={<span>{prs.length}</span>}>
            <ul className="divide-y divide-line">
              {prs.map((p) => (
                <li key={p.number}>
                  <Link
                    to={`/pull-requests/${p.number}`}
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
          </Panel>
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Branch protection" meta={<span>main</span>}>
            <ul className="space-y-2 px-3.5 py-3">
              {protection.map((p) => (
                <li key={p.label} className="flex items-start gap-2 text-[12.5px] text-ink">
                  {p.ok ? (
                    <CircleCheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                  ) : (
                    <CircleXIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />
                  )}
                  {p.label}
                </li>
              ))}
            </ul>
            {!protection.every((p) => p.ok) && (
              <p className="border-t border-line px-3.5 py-2.5 text-[12px] text-muted">
                Change these in GitHub. DevHQ doesn’t request administration permissions.
              </p>
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
