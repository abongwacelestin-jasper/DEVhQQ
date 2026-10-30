import { Link } from 'react-router-dom';
import { SparklesIcon } from 'lucide-react';
import { WelcomeIllustration } from '../components/illustrations/WelcomeIllustration';
import { Panel } from '../components/ui/Panel';
import { KpiStrip, type Kpi } from '../components/overview/KpiStrip';
import { ProductHealthTable } from '../components/overview/ProductHealthTable';
import { AttentionList } from '../components/overview/AttentionList';
import { ReleasesList } from '../components/overview/ReleasesList';
import { WorkloadList } from '../components/overview/WorkloadList';
import { ActivityFeed } from '../components/overview/ActivityFeed';
import { DeployFrequencyChart } from '../components/delivery/DeployFrequencyChart';
import { DeploymentsTable } from '../components/delivery/DeploymentsTable';
import { TraceChain } from '../components/work/TraceChain';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { activity, attention, products, releases } from '../data/portfolio';
import { projects } from '../data/work';
import { useWork } from '../contexts/WorkContext';
import { useDateRange } from '../contexts/DateRangeContext';
import { Avatar } from '../components/ui/Avatar';
import { firstName } from '../utils/status';
import { formatDateTime, relative } from '../utils/date';
import { describeEvent } from '../utils/taskEvents';
import { pullRequests, traces } from '../data/engineering';
import { deployments, incidents } from '../data/operations';
import { members } from '../data/team';
import { CountPills, OutcomeColumns, SplitBar } from '../components/overview/KpiVisuals';
import type { ProductId } from '../types/portfolio';

const productFill: Record<ProductId, string> = {
  renewberry: 'bg-accent',
  blog: 'bg-info',
  mirror: 'bg-warn',
};

export function Overview() {
  const { matches, matchesTask, matchesProject } = useProductFilter();
  const { setAssistantOpen, openTask } = useWorkspaceUI();

  const { tasks, events } = useWork();
  const { inRange, label, short } = useDateRange();
  const ps = products.filter((p) => matches(p.id));
  const scoped = tasks.filter((t) => matchesTask(t));
  const openTasks = scoped.filter((t) => t.status !== 'done').length;
  const late = scoped.filter((t) => t.overdue).length;
  const rangeEvents = events
    .filter((e) => inRange(new Date(e.at)) && scoped.some((t) => t.key === e.taskKey))
    .sort((a, b) => b.at.localeCompare(a.at));
  const completed = rangeEvents.filter((e) => e.kind === 'status' && e.to === 'done').length;
  const reviews = pullRequests.filter(
    (p) => matches(p.product) && p.review === 'review-required',
  ).length;
  const deploys = deployments.filter((d) => matches(d.product) && d.status !== 'running');
  const failed = deploys.filter((d) => d.status === 'failed').length;
  const openIncidents = incidents.filter((i) => matches(i.product) && i.status !== 'resolved');
  const activeProjects = projects.filter(
    (p) => matchesProject(p.id, p.product) && p.status !== 'planned',
  ).length;

  // --- Per-metric breakdowns that drive each card's visual ---
  const projectSplit = ps.map((p) => ({
    label: p.name.split(' ')[0],
    value: projects.filter(
      (x) => x.product === p.id && matchesProject(x.id, x.product) && x.status !== 'planned',
    ).length,
    className: productFill[p.id],
  }));
  const openList = scoped.filter((t) => t.status !== 'done');
  const taskSplit = [
    {
      label: 'To do',
      value: openList.filter((t) => !t.overdue && t.status === 'backlog').length,
      className: 'bg-line-strong',
    },
    {
      label: 'In progress',
      value: openList.filter((t) => !t.overdue && t.status !== 'backlog').length,
      className: 'bg-accent',
    },
    { label: 'Overdue', value: openList.filter((t) => t.overdue).length, className: 'bg-bad' },
  ];

  const waiting = pullRequests.filter((p) => matches(p.product) && p.review === 'review-required');
  const ageDays = (age: string) => (age.endsWith('d') ? parseInt(age, 10) : 0);
  const reviewAges = [
    { label: '<1d', value: waiting.filter((p) => ageDays(p.age) < 1).length, tone: 'ok' as const },
    {
      label: '1–2d',
      value: waiting.filter((p) => ageDays(p.age) >= 1 && ageDays(p.age) <= 2).length,
      tone: 'warn' as const,
    },
    {
      label: '3d+',
      value: waiting.filter((p) => ageDays(p.age) >= 3).length,
      tone: 'bad' as const,
    },
  ];

  const oldest = Math.max(0, ...waiting.map((p) => ageDays(p.age)));
  const daysAgo = (ago: string) => (ago.endsWith('d') ? parseInt(ago, 10) : 0);
  const week = deploys.filter((d) => daysAgo(d.ago) < 7);
  const weekFailed = week.filter((d) => d.status === 'failed' || d.status === 'rolled-back').length;
  const deployDays = Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const day = new Date(Date.now() - offset * 86_400_000).toLocaleDateString('en-US', {
      weekday: 'short',
    });
    const items = week.filter((d) => daysAgo(d.ago) === offset);
    const bad = items.filter((d) => d.status === 'failed' || d.status === 'rolled-back').length;
    return { day, ok: items.length - bad, failed: bad };
  });
  const sevs = (['SEV1', 'SEV2', 'SEV3'] as const).map((s, i) => ({
    label: s,
    value: openIncidents.filter((x) => x.severity === s).length,
    tone: (['bad', 'warn', 'info'] as const)[i],
  }));

  const kpis: Kpi[] = [
    {
      label: 'Active projects',
      value: activeProjects,
      sub: `${ps.length} product${ps.length > 1 ? 's' : ''}`,
      to: '/projects',
      viz: <SplitBar segments={projectSplit} label="Active projects by product" />,
      delta: { label: '+1', good: true, up: true },
    },
    {
      label: 'Open tasks',
      value: openTasks,
      sub: `${completed} done ${short}`,
      to: '/projects',
      viz: <SplitBar segments={taskSplit} label="Open tasks by status" />,
      delta: { label: '−6%', good: true, up: false },
    },
    {
      label: 'Reviews waiting',
      value: reviews,
      sub: oldest ? `oldest ${oldest}d` : 'none waiting',
      subTone: oldest >= 3 ? 'warn' : undefined,
      to: '/pull-requests',
      valueTone: reviews ? 'warn' : undefined,
      viz: <CountPills items={reviewAges} label="Reviews waiting by age" />,
      delta: { label: '+2', good: false, up: true },
    },
    {
      label: 'Deploys · 7d',
      value: week.length,
      sub: `${weekFailed} failed`,
      subTone: weekFailed ? 'bad' : undefined,
      to: '/deployments',
      viz: <OutcomeColumns days={deployDays} label="Deploys per day, last 7 days" />,
      delta: { label: '+12%', good: true, up: true },
    },
    {
      label: 'Open incidents',
      value: openIncidents.length,
      sub: openIncidents.length ? 'by severity' : 'all clear',
      valueTone: openIncidents.length ? 'bad' : 'ok',
      to: '/incidents',
      viz: <CountPills items={sevs} label="Open incidents by severity" />,
      delta: { label: '+1', good: false, up: true },
    },
  ];

  const trace = traces.find((t) =>
    matches(tasks.find((k) => k.key === t.taskKey)?.product ?? 'renewberry'),
  );
  const traceTask = tasks.find((t) => t.key === trace?.taskKey);
  const team = members
    .filter((m) => m.status === 'active' && m.role !== 'Owner' && m.products.some(matches))
    .sort((a, b) => b.openTasks - a.openTasks)
    .slice(0, 7);

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-4 overflow-hidden rounded-lg border border-line bg-accent-soft/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">
            Good afternoon, Amara
          </h1>
          <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
            <b className="font-semibold text-ink">{late} overdue tasks</b>,{' '}
            <b className="font-semibold text-bad">
              {failed} failed deploy{failed === 1 ? '' : 's'}
            </b>{' '}
            and{' '}
            <b className="font-semibold text-bad">
              {openIncidents.length} open incident{openIncidents.length === 1 ? '' : 's'}
            </b>{' '}
            across {ps.length} product{ps.length > 1 ? 's' : ''}. Health is derived from live task,
            deploy and monitor data.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              onClick={() => setAssistantOpen(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-ink px-2.5 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-ink/90"
            >
              <SparklesIcon className="h-3.5 w-3.5" />
              What’s blocking a release?
            </button>
            <Link
              to="/my-work"
              className="inline-flex h-7 items-center rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink hover:border-line-strong"
            >
              Review my approvals
            </Link>
          </div>
        </div>
        <WelcomeIllustration className="hidden h-[104px] w-auto shrink-0 sm:block" />
      </section>

      <KpiStrip items={kpis} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Panel title="Products" meta={<span>Health from live data</span>}>
            <ProductHealthTable rows={ps} />
          </Panel>

          {trace && traceTask && (
            <Panel
              title="Task to production trace"
              meta={
                <button
                  onClick={() => openTask(traceTask.key)}
                  className="truncate font-medium text-accent hover:underline"
                >
                  {traceTask.key} {traceTask.title}
                </button>
              }
            >
              <div className="px-3.5 pb-2.5 pt-3">
                <TraceChain steps={trace.steps} />
                <p className="mt-2 text-[12px] text-muted">{trace.note}</p>
              </div>
            </Panel>
          )}
        </div>

        <Panel
          title="Needs attention"
          meta={
            <span className="rounded-md bg-bad-soft px-1.5 font-semibold text-bad">
              {attention.filter((a) => matches(a.product)).length}
            </span>
          }
          className="xl:row-span-1"
        >
          <AttentionList items={attention.filter((a) => matches(a.product))} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Recent deployments"
          className="min-w-0 lg:col-span-2"
          action={
            <Link to="/deployments" className="font-medium text-accent hover:underline">
              View all
            </Link>
          }
        >
          <DeploymentsTable rows={deploys.slice(0, 6)} />
        </Panel>
        <Panel
          title="Upcoming releases"
          action={
            <Link to="/projects?view=timeline" className="font-medium text-accent hover:underline">
              Roadmap
            </Link>
          }
        >
          <ReleasesList items={releases.filter((r) => matches(r.product))} />
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Team workload" meta={<span>open / capacity</span>}>
          <WorkloadList items={team} />
        </Panel>
        <Panel title="Deployment frequency" meta={<span>Last 7 days</span>}>
          <DeployFrequencyChart />
        </Panel>
        <Panel
          title="Task changes"
          meta={<span>{label}</span>}
          action={
            <Link to="/activity" className="font-medium text-accent hover:underline">
              All
            </Link>
          }
          className="md:col-span-2 xl:col-span-1"
        >
          {rangeEvents.length === 0 ? (
            <p className="px-3.5 py-3 text-[12.5px] text-muted">No task changes in this range.</p>
          ) : (
            <ol className="divide-y divide-line">
              {rangeEvents.slice(0, 7).map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 px-3.5 py-1.5"
                >
                  <Avatar id={e.actor} size="xs" />
                  <p className="min-w-0 truncate text-[12px] text-ink">
                    <span className="font-semibold">{firstName(e.actor)}</span>{' '}
                    <span className="text-muted">{describeEvent(e)}</span>{' '}
                    <Link
                      to={`/tasks/${e.taskKey}`}
                      className="font-mono font-medium text-accent hover:underline"
                    >
                      {e.taskKey}
                    </Link>
                  </p>
                  <time
                    className="text-[11px] tabular-nums text-muted"
                    title={formatDateTime(new Date(e.at))}
                  >
                    {relative(new Date(e.at))}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="grid gap-4">
        <Panel
          title="Platform activity"
          meta={
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
              Live
            </span>
          }
        >
          <ActivityFeed items={activity.filter((a) => matches(a.product))} />
        </Panel>
      </div>
    </div>
  );
}
