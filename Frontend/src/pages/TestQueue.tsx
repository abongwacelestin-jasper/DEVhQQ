import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BugIcon, CircleCheckIcon, CircleXIcon, GitPullRequestIcon } from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { FilterBar } from '../components/filters/FilterBar';
import { ChecklistIllustration } from '../components/illustrations/ChecklistIllustration';
import { EmptyIllustration } from '../components/illustrations/EmptyIllustration';
import { useWork } from '../contexts/WorkContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { useAuth } from '../contexts/AuthContext';
import { useDeployments } from '../hooks/useDeployments';
import { useApiList } from '../components/engineering/data/useApi';
import { EVENTS, useCiRuns } from '../components/engineering/data/hooks';
import type { ApiPull } from '../components/engineering/data/types';
import { DataState, LoadingRows, SampleDataBadge } from '../components/engineering/states';
import { ago, duration, pullHref, runMeta } from '../components/engineering/format';
import { ciMeta, deployMeta, firstName, priorityMeta, taskStatusMeta } from '../utils/status';

const keys = ['q', 'product', 'priority'] as const;

/** Tester home: work waiting for verification, open bugs and what's on staging. */
export function TestQueue() {
  const { tasks, updateTask, addComment } = useWork();
  const { matchesTask, allowedProducts } = useProductFilter();
  const { openCreateTask } = useWorkspaceUI();
  const { can } = useAuth();
  // PR CI status for queued tasks; only requested when the role can see pull requests.
  const pulls = useApiList<ApiPull>(can('pull-requests') ? '/api/pulls?state=open' : null, {
    events: EVENTS.pulls,
  });
  const f = useUrlFilters(keys);
  const v = f.values;
  const apply = useCallback(
    (vals: Record<string, string>) =>
      f.setMany(Object.fromEntries(keys.map((k) => [k, vals[k] ?? '']))),
    [f],
  );

  const scoped = useMemo(
    () =>
      tasks.filter(
        (t) =>
          matchesTask(t) &&
          (!v.product || t.product === v.product) &&
          (!v.priority || t.priority === v.priority) &&
          (!v.q || `${t.key} ${t.title}`.toLowerCase().includes(v.q.toLowerCase())),
      ),
    [tasks, matchesTask, v],
  );
  const queue = scoped.filter((t) => t.status === 'review');
  const bugs = scoped.filter((t) => t.type === 'bug' && t.status !== 'done');

  const pass = (key: string) => {
    addComment(key, 'QA passed on staging — acceptance criteria verified.');
    toast.success(`${key} passed testing`, {
      description: 'Comment recorded with your name and time.',
    });
  };
  const fail = (key: string) => {
    updateTask(key, { status: 'in-progress' }, 'QA failed — sent back to the assignee');
    toast.error(`${key} sent back`, { description: 'Status change recorded in the task history.' });
  };

  return (
    <div className="space-y-3.5">
      <PageHero
        illustration={<ChecklistIllustration className="h-[84px] w-auto" />}
        title="Test queue"
        description="Work waiting for verification on staging, open bugs and the latest staging deploys. Every pass or fail is recorded on the task."
        actions={
          <Button
            size="sm"
            variant="primary"
            icon={<BugIcon className="h-3.5 w-3.5" />}
            onClick={() => openCreateTask({ type: 'bug', priority: 'high' })}
          >
            Report bug
          </Button>
        }
        stats={[
          { label: 'To test', value: queue.length, tone: queue.length ? 'warn' : undefined },
          { label: 'Open bugs', value: bugs.length },
          {
            label: 'Urgent bugs',
            value: bugs.filter((b) => b.priority === 'urgent').length,
            tone: bugs.some((b) => b.priority === 'urgent') ? 'bad' : undefined,
          },
        ]}
      />

      <FilterBar
        id="test-queue"
        values={v}
        onChange={(k, val) => f.set(k as (typeof keys)[number], val)}
        onApply={apply}
        onReset={f.reset}
        activeCount={f.activeCount}
        count={queue.length + bugs.length}
        noun="items"
        search={{ key: 'q', placeholder: 'Search tasks…' }}
        selects={[
          {
            key: 'product',
            label: 'Product',
            options: allowedProducts.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            key: 'priority',
            label: 'Priority',
            options: Object.entries(priorityMeta).map(([value, m]) => ({ value, label: m.label })),
          },
        ]}
      />

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3.5">
          <Panel
            title="Waiting for testing"
            meta={<span className="tabular-nums">{queue.length}</span>}
          >
            {queue.length === 0 ? (
              <div className="flex items-center justify-center gap-3 px-4 py-8">
                <EmptyIllustration className="h-14 w-auto" />
                <p className="text-[12.5px] text-muted">
                  Nothing waiting. New work lands here when it moves to review.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {queue.map((t) => {
                  const pr = t.pr
                    ? (pulls.items.find((p) => p.taskKey === t.key && p.number === t.pr) ??
                      pulls.items.find((p) => p.number === t.pr))
                    : undefined;
                  return (
                    <li
                      key={t.key}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-2 md:grid-cols-[minmax(0,1fr)_110px_120px_auto]"
                    >
                      <Link
                        to={`/tasks/${t.key}`}
                        className="flex min-w-0 items-center gap-2 hover:underline"
                      >
                        <ProductMark product={t.product} size="sm" />
                        <span className="font-mono text-[11.5px] text-muted">{t.key}</span>
                        <span className="truncate text-[12.5px] font-semibold text-ink">
                          {t.title}
                        </span>
                      </Link>
                      <span className="hidden items-center gap-1.5 text-[12px] text-ink md:flex">
                        <Avatar id={t.assignee} size="xs" />
                        {firstName(t.assignee)}
                      </span>
                      <span className="hidden md:block">
                        {pr ? (
                          <Link
                            to={pullHref(pr)}
                            className="inline-flex items-center gap-1 text-[12px] text-ink hover:underline"
                          >
                            <GitPullRequestIcon className="h-3.5 w-3.5 text-muted" aria-hidden />#
                            {pr.number} <StatusBadge {...ciMeta[pr.ci]} dot />
                          </Link>
                        ) : t.pr ? (
                          <Link
                            to={`/pull-requests/${t.pr}`}
                            className="inline-flex items-center gap-1 text-[12px] text-ink hover:underline"
                          >
                            <GitPullRequestIcon className="h-3.5 w-3.5 text-muted" aria-hidden />#
                            {t.pr}
                          </Link>
                        ) : (
                          <span className="text-[12px] text-muted">No PR</span>
                        )}
                      </span>
                      <span className="col-span-2 flex gap-1.5 md:col-span-1">
                        <Button
                          size="sm"
                          icon={<CircleCheckIcon className="h-3.5 w-3.5 text-ok" />}
                          onClick={() => pass(t.key)}
                        >
                          Pass
                        </Button>
                        <Button
                          size="sm"
                          icon={<CircleXIcon className="h-3.5 w-3.5 text-bad" />}
                          onClick={() => fail(t.key)}
                        >
                          Fail
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Open bugs" meta={<span className="tabular-nums">{bugs.length}</span>}>
            <ul className="divide-y divide-line">
              {bugs.map((t) => (
                <li key={t.key}>
                  <Link
                    to={`/tasks/${t.key}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-1.5 hover:bg-sunken/50 md:grid-cols-[minmax(0,1fr)_96px_80px_90px_60px]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ProductMark product={t.product} size="sm" />
                      <span className="font-mono text-[11.5px] text-muted">{t.key}</span>
                      <span className="truncate text-[12.5px] font-medium text-ink">{t.title}</span>
                    </span>
                    <span className="hidden md:block">
                      <StatusBadge {...taskStatusMeta[t.status]} dot />
                    </span>
                    <StatusBadge {...priorityMeta[t.priority]} />
                    <span className="hidden truncate text-[12px] text-ink md:block">
                      {firstName(t.assignee)}
                    </span>
                    <span
                      className={`hidden text-right text-[12px] tabular-nums md:block ${t.overdue ? 'font-semibold text-bad' : 'text-ink'}`}
                    >
                      {t.due}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="grid content-start gap-3.5">
          {can('deployments') ? (
            <StagingPanel />
          ) : (
            <Panel title="Latest on staging">
              <p className="px-3.5 py-3 text-[12px] text-muted">
                Your role can’t view deployments.
              </p>
            </Panel>
          )}
          {can('repositories') && <CiRunsPanel />}
        </div>
      </div>
    </div>
  );
}

/** Newest staging deployments, from `/api/deployments`. */
function StagingPanel() {
  const { matches } = useProductFilter();
  const { deployments, loading, error, reload } = useDeployments();
  const staging = deployments.filter((d) => matches(d.product) && d.env === 'staging').slice(0, 6);
  return (
    <Panel title="Latest on staging">
      {loading ? (
        <LoadingRows rows={3} label="Loading deployments" />
      ) : error && !deployments.length ? (
        <DataState status="error" error={error} what="Deployments" onRetry={() => void reload()} />
      ) : staging.length === 0 ? (
        <p className="px-3.5 py-3 text-[12px] text-muted">No staging deployments recorded.</p>
      ) : (
        <ul className="divide-y divide-line">
          {staging.map((d) => (
            <li key={d.id}>
              <Link
                to={`/deployments/${d.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3.5 py-2 hover:bg-sunken/50"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                    <ProductMark product={d.product} size="sm" />
                    <span className="font-mono">{d.sha}</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {d.message} · {d.ago}
                  </span>
                </span>
                <StatusBadge {...deployMeta[d.status]} dot />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Recent CI runs across repositories, from `/api/ci/runs`. */
function CiRunsPanel() {
  const runs = useCiRuns();
  return (
    <Panel title="Recent CI runs" meta={<SampleDataBadge source={runs.source} />}>
      {runs.status !== 'ready' ? (
        <DataState
          status={runs.status}
          error={runs.error}
          what="CI runs"
          github
          onRetry={runs.reload}
          rows={3}
        />
      ) : runs.items.length === 0 ? (
        <p className="px-3.5 py-3 text-[12px] text-muted">No CI runs reported yet.</p>
      ) : (
        <table className="w-full text-left text-[12px]">
          <caption className="sr-only">Recent CI runs</caption>
          <thead className="border-b border-line bg-sunken/40 text-[11px] text-muted">
            <tr>
              <th scope="col" className="px-3.5 py-1.5 font-medium">
                Run
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-3.5 py-1.5 text-right font-medium">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {runs.items.slice(0, 10).map((r) => (
              <tr key={r.id}>
                <td className="min-w-0 px-3.5 py-1.5">
                  {r.pr ? (
                    <Link
                      to={pullHref({ number: r.pr, repoId: r.repoId })}
                      className="block truncate font-medium text-ink hover:underline"
                    >
                      {r.workflow}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium text-ink">{r.workflow}</span>
                  )}
                  <span className="block truncate font-mono text-[11px] text-muted">
                    {r.repo} · {r.branch} · {r.sha.slice(0, 7)}
                  </span>
                  {r.tests && (
                    <span className="block text-[11px] text-muted">
                      {r.tests.passed} passed · {r.tests.failed} failed · {r.tests.skipped} skipped
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <StatusBadge {...runMeta[r.status]} dot />
                </td>
                <td className="whitespace-nowrap px-3.5 py-1.5 text-right text-[11px] text-muted">
                  {ago(r.startedAt)}
                  <span className="block">{duration(r.durationMs)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
