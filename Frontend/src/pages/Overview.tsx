import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SparklesIcon } from 'lucide-react';
import { WelcomeIllustration } from '../components/illustrations/WelcomeIllustration';
import { Panel } from '../components/ui/Panel';
import { SearchInput } from '../components/ui/SearchInput';
import { KpiStrip, type Kpi } from '../components/overview/KpiStrip';
import { ProductHealthTable } from '../components/overview/ProductHealthTable';
import { AttentionList } from '../components/overview/AttentionList';
import { WorkloadList } from '../components/overview/WorkloadList';
import { DeploymentsTable } from '../components/delivery/DeploymentsTable';
import { IncidentRow } from '../components/operations/IncidentRow';
import { ProductMark } from '../components/ui/ProductMark';
import { StatusBadge } from '../components/ui/StatusBadge';
import { projectStatusMeta } from '../utils/status';
import { CountPills, OutcomeColumns, SplitBar } from '../components/overview/KpiVisuals';
import { Avatar } from '../components/ui/Avatar';
import { useOverviewData } from '../hooks/useOverviewData';
import { daysAgo } from '../utils/metrics';
import { useWork } from '../contexts/WorkContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { useDateRange } from '../contexts/DateRangeContext';
import { useAuth } from '../contexts/AuthContext';
import { firstName, memberById } from '../utils/status';
import { formatDateTime, relative } from '../utils/date';
import { describeEvent } from '../utils/taskEvents';
import type { AttentionItem, ProductId } from '../types/portfolio';

const productFill: Record<ProductId, string> = {
  renewberry: 'bg-accent',
  blog: 'bg-info',
  mirror: 'bg-warn',
};

/** Every section filters over the rows it already has — typing never re-queries the API. */
const hit = (haystack: (string | number | undefined | null)[], term: string) =>
  !term || haystack.join(' ').toLowerCase().includes(term.trim().toLowerCase());

export function Overview() {
  const { matches, matchesTask, matchesProject } = useProductFilter();
  const { setAssistantOpen, openTask } = useWorkspaceUI();
  const { session } = useAuth();
  const { tasks, events } = useWork();
  const { inRange, label, short } = useDateRange();
  const { rows, projects, team, loading, error, openIncidents, deployments } = useOverviewData();

  const [q, setQ] = useState({
    products: '',
    attention: '',
    deploys: '',
    incidents: '',
    team: '',
    events: '',
    projects: '',
    approvals: '',
  });
  const set = (key: keyof typeof q) => (value: string) => setQ((s) => ({ ...s, [key]: value }));

  const ps = rows.filter((p) => matches(p.id));
  const scoped = tasks.filter((t) => matchesTask(t));
  const openList = scoped.filter((t) => t.status !== 'done');
  const lateTasks = openList.filter((t) => t.overdue);

  const rangeEvents = events
    .filter((e) => inRange(new Date(e.at)) && scoped.some((t) => t.key === e.taskKey))
    .sort((a, b) => b.at.localeCompare(a.at));
  const completed = rangeEvents.filter((e) => e.kind === 'status' && e.to === 'done').length;

  const scopedDeploys = deployments.filter((d) => matches(d.product));
  const failedDeploys = scopedDeploys.filter(
    (d) => (d.status === 'failed' || d.status === 'rolled-back') && daysAgo(d.ago) < 7,
  );
  const awaiting = scopedDeploys.filter((d) => d.status === 'awaiting-approval');
  const week = scopedDeploys.filter((d) => daysAgo(d.ago) < 7);

  const activeProjects = projects.filter(
    (p) => matchesProject(p.id, p.product) && p.status !== 'planned',
  );
  const scopedIncidents = openIncidents.filter((i) => matches(i.product));

  const member = session ? memberById(session.memberId) : undefined;
  const greeting = new Date().getHours() < 12 ? 'Good morning' : 'Good afternoon';

  // --- Per-metric breakdowns that drive each card's visual ---
  const projectSplit = ps.map((p) => ({
    label: p.name.split(' ')[0],
    value: projects.filter(
      (x) => x.product === p.id && matchesProject(x.id, x.product) && x.status !== 'planned',
    ).length,
    className: productFill[p.id],
  }));
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
    { label: 'Overdue', value: lateTasks.length, className: 'bg-bad' },
  ];
  const approvalSplit = [
    {
      label: 'Production',
      value: awaiting.filter((d) => d.env === 'production').length,
      tone: 'bad' as const,
    },
    {
      label: 'Staging',
      value: awaiting.filter((d) => d.env !== 'production').length,
      tone: 'info' as const,
    },
  ];
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
    value: scopedIncidents.filter((x) => x.severity === s).length,
    tone: (['bad', 'warn', 'info'] as const)[i],
  }));

  const successRate = week.length
    ? Math.round(((week.length - failedDeploys.length) / week.length) * 100)
    : 0;
  const sev1 = scopedIncidents.filter((i) => i.severity === 'SEV1').length;

  const kpis: Kpi[] = [
    {
      label: 'Active projects',
      value: activeProjects.length,
      sub: `${ps.length} product${ps.length === 1 ? '' : 's'}`,
      to: '/projects',
      viz: <SplitBar segments={projectSplit} label="Active projects by product" />,
      note: {
        label: `${ps.filter((p) => p.health !== 'healthy').length} not healthy`,
        tone: ps.some((p) => p.health !== 'healthy') ? 'warn' : 'ok',
      },
    },
    {
      label: 'Open tasks',
      value: openList.length,
      sub: `${completed} done ${short}`,
      subTone: completed ? 'ok' : undefined,
      to: '/projects',
      valueTone: lateTasks.length ? 'warn' : undefined,
      viz: <SplitBar segments={taskSplit} label="Open tasks by status" />,
      note: {
        label: `${lateTasks.length} overdue`,
        tone: lateTasks.length ? 'bad' : 'ok',
      },
    },
    {
      label: 'Awaiting approval',
      value: awaiting.length,
      sub: awaiting.length
        ? `deploy${awaiting.length === 1 ? '' : 's'} to release`
        : 'nothing waiting',
      subTone: awaiting.length ? 'warn' : undefined,
      to: '/deployments',
      valueTone: awaiting.length ? 'warn' : undefined,
      viz: <CountPills items={approvalSplit} label="Deploys awaiting approval by environment" />,
      note: {
        label: awaiting.some((d) => d.env === 'production') ? 'prod blocked' : 'clear',
        tone: awaiting.some((d) => d.env === 'production') ? 'bad' : 'ok',
      },
    },
    {
      label: 'Deploys · 7d',
      value: week.length,
      sub: `${failedDeploys.length} failed`,
      subTone: failedDeploys.length ? 'bad' : undefined,
      to: '/deployments',
      viz: <OutcomeColumns days={deployDays} label="Deploys per day, last 7 days" />,
      note: {
        label: `${successRate}% ok`,
        tone: successRate >= 90 ? 'ok' : successRate >= 75 ? 'warn' : 'bad',
      },
    },
    {
      label: 'Open incidents',
      value: scopedIncidents.length,
      sub: scopedIncidents.length ? 'by severity' : 'all clear',
      valueTone: scopedIncidents.length ? 'bad' : 'ok',
      to: '/incidents',
      viz: <CountPills items={sevs} label="Open incidents by severity" />,
      note: {
        label: sev1 ? `${sev1} SEV1` : scopedIncidents.length ? 'no SEV1' : 'none open',
        tone: sev1 ? 'bad' : scopedIncidents.length ? 'warn' : 'ok',
      },
    },
  ];

  /** What needs a human: overdue work, blocked releases, failures, open incidents. */
  const attention: AttentionItem[] = useMemo(() => {
    const name = (id: ProductId) => rows.find((r) => r.id === id)?.name ?? id;
    return [
      ...lateTasks.map((t) => ({
        id: `late-${t.key}`,
        product: t.product,
        title: `${t.key} · ${t.title}`,
        detail: `Due ${t.due} · ${firstName(t.assignee)}`,
        meta: 'overdue',
        tone: 'bad' as const,
        to: `/tasks/${t.key}`,
      })),
      ...awaiting.map((d) => ({
        id: `approve-${d.id}`,
        product: d.product,
        title: `${name(d.product)} ${d.env} deploy needs approval`,
        detail: `${d.sha} ${d.message} · requested by ${firstName(d.author)}`,
        meta: 'approval',
        tone: 'warn' as const,
        to: '/deployments',
      })),
      ...failedDeploys.map((d) => ({
        id: `fail-${d.id}`,
        product: d.product,
        title: `${name(d.product)} deploy ${d.status === 'failed' ? 'failed' : 'rolled back'}`,
        detail: `${d.sha} ${d.message} · ${d.env}`,
        meta: d.ago,
        tone: 'bad' as const,
        to: `/deployments/${d.id}`,
      })),
      ...scopedIncidents.map((i) => ({
        id: `inc-${i.id}`,
        product: i.product,
        title: `${i.severity} · ${i.title}`,
        detail: `${i.service} · ${i.impact}`,
        meta: i.duration,
        tone: 'bad' as const,
        to: `/incidents/${i.id}`,
      })),
    ];
  }, [lateTasks, awaiting, failedDeploys, scopedIncidents, rows]);

  const attentionHits = attention.filter((a) => hit([a.title, a.detail, a.meta], q.attention));
  const productHits = ps.filter((p) => hit([p.name, p.code, p.health, ...p.reasons], q.products));
  const deployHits = scopedDeploys.filter((d) =>
    hit([d.product, d.env, d.sha, d.message, d.status, d.provider], q.deploys),
  );
  const incidentHits = scopedIncidents.filter((i) =>
    hit([i.title, i.severity, i.status, i.service, i.owner], q.incidents),
  );
  const teamHits = team
    .filter((m) => m.status === 'active' && m.products.some(matches))
    .filter((m) => hit([m.name, m.role, m.email], q.team))
    .sort((a, b) => b.openTasks - a.openTasks)
    .slice(0, 8);
  const projectHits = projects
    .filter((p) => matchesProject(p.id, p.product))
    .filter((p) => hit([p.name, p.product, p.status, p.lead, firstName(p.lead)], q.projects));
  const approvalHits = awaiting.filter((d) =>
    hit([d.product, d.env, d.sha, d.message, d.author], q.approvals),
  );
  const eventHits = rangeEvents
    .filter((e) => hit([e.taskKey, e.kind, e.actor, e.note ?? ''], q.events))
    .slice(0, 7);

  return (
    <div className="space-y-3">
      <section className="flex items-center gap-4 overflow-hidden rounded-lg border border-line bg-accent-soft/40 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">
            {greeting}
            {member ? `, ${member.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-muted">
            <b className="font-semibold text-ink">{lateTasks.length} overdue tasks</b>,{' '}
            <b className="font-semibold text-bad">
              {failedDeploys.length} failed deploy{failedDeploys.length === 1 ? '' : 's'}
            </b>{' '}
            and{' '}
            <b className="font-semibold text-bad">
              {scopedIncidents.length} open incident{scopedIncidents.length === 1 ? '' : 's'}
            </b>{' '}
            across {ps.length} product{ps.length === 1 ? '' : 's'}. Every figure below is read from
            the API for your scope.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => setAssistantOpen(true)}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-ink px-2 text-[11.5px] font-medium text-white transition-colors duration-150 hover:bg-ink/90"
            >
              <SparklesIcon className="h-3.5 w-3.5" />
              What’s blocking a release?
            </button>
            <Link
              to="/my-work"
              className="inline-flex h-[26px] items-center rounded-md border border-line bg-white px-2 text-[11.5px] font-medium text-ink hover:border-line-strong"
            >
              Review my approvals
            </Link>
          </div>
        </div>
        <WelcomeIllustration className="hidden h-20 w-auto shrink-0 sm:block" />
      </section>

      {error && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[12px] text-warn">
          {error} Numbers below may be incomplete.
        </p>
      )}

      <KpiStrip items={kpis} />

      <Panel
        title="Products"
        meta={<span>{loading ? 'Loading…' : `${ps.length} in scope`}</span>}
        filter={
          <SearchInput
            value={q.products}
            onChange={set('products')}
            placeholder="Filter products by name, code or health…"
            label="Filter products"
          />
        }
      >
        <ProductHealthTable rows={productHits} loading={loading} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          title="Recent deployments"
          className="min-w-0 lg:col-span-2"
          meta={<span>{deployHits.length} shown</span>}
          action={
            <Link to="/deployments" className="font-medium text-accent hover:underline">
              View all
            </Link>
          }
          filter={
            <SearchInput
              value={q.deploys}
              onChange={set('deploys')}
              placeholder="Filter deployments by product, env, commit or status…"
              label="Filter deployments"
            />
          }
        >
          <DeploymentsTable rows={deployHits.slice(0, 6)} />
        </Panel>

        <Panel
          title="Needs attention"
          meta={
            <span className="rounded-md bg-bad-soft px-1.5 font-semibold text-bad">
              {attentionHits.length}
            </span>
          }
          filter={
            <SearchInput
              value={q.attention}
              onChange={set('attention')}
              placeholder="Filter by incident, task or commit…"
              label="Filter what needs attention"
            />
          }
        >
          <AttentionList items={attentionHits.slice(0, 8)} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          title="Open incidents"
          className="min-w-0 lg:col-span-2"
          meta={<span>{scopedIncidents.length} unresolved</span>}
          action={
            <Link to="/incidents" className="font-medium text-accent hover:underline">
              Incident console
            </Link>
          }
          filter={
            <SearchInput
              value={q.incidents}
              onChange={set('incidents')}
              placeholder="Filter incidents by title, severity, service or owner…"
              label="Filter incidents"
            />
          }
        >
          {incidentHits.length === 0 ? (
            <p className="px-3.5 py-4 text-center text-[12px] text-muted">
              {scopedIncidents.length === 0
                ? 'No open incidents in this scope.'
                : 'No incidents match this filter.'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {incidentHits.slice(0, 6).map((i) => (
                <IncidentRow key={i.id} incident={i} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Team workload"
          meta={<span>open / capacity</span>}
          filter={
            <SearchInput
              value={q.team}
              onChange={set('team')}
              placeholder="Filter people by name or role…"
              label="Filter team workload"
            />
          }
        >
          <WorkloadList items={teamHits} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          title="Projects"
          className="min-w-0 lg:col-span-2"
          meta={<span>{activeProjects.length} active</span>}
          action={
            <Link to="/projects" className="font-medium text-accent hover:underline">
              Open board
            </Link>
          }
          filter={
            <SearchInput
              value={q.projects}
              onChange={set('projects')}
              placeholder="Filter projects by name, product, lead or status…"
              label="Filter projects"
            />
          }
        >
          {projectHits.length === 0 ? (
            <p className="px-3.5 py-3 text-[12px] text-muted">No projects match this filter.</p>
          ) : (
            <ul className="divide-y divide-line">
              {projectHits.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projects/${p.id}`}
                    className="flex items-center gap-2 px-3.5 py-1.5 transition-colors duration-150 hover:bg-sunken/50"
                  >
                    <ProductMark product={p.product} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                      {p.name}
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-muted sm:block">
                      {firstName(p.lead)}
                    </span>
                    <StatusBadge {...projectStatusMeta[p.status]} dot />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Awaiting approval"
          meta={
            <span className={awaiting.length ? 'font-semibold text-warn' : 'text-muted'}>
              {awaiting.length} pending
            </span>
          }
          filter={
            <SearchInput
              value={q.approvals}
              onChange={set('approvals')}
              placeholder="Filter pending deploys…"
              label="Filter pending approvals"
            />
          }
        >
          {approvalHits.length === 0 ? (
            <p className="px-3.5 py-3 text-[12px] text-muted">
              {awaiting.length === 0 ? 'Nothing waiting for approval.' : 'No matches.'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {approvalHits.map((d) => (
                <li key={d.id}>
                  <Link
                    to={`/deployments/${d.id}`}
                    className="flex items-center gap-2 px-3.5 py-1.5 transition-colors duration-150 hover:bg-sunken/50"
                  >
                    <ProductMark product={d.product} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      <span className="font-mono text-ink">{d.sha}</span>{' '}
                      <span className="text-muted">{d.env}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">{d.ago}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Task changes"
        meta={<span>{label}</span>}
        action={
          <Link to="/activity" className="font-medium text-accent hover:underline">
            All
          </Link>
        }
        filter={
          <SearchInput
            value={q.events}
            onChange={set('events')}
            placeholder="Filter changes by task, person or kind…"
            label="Filter task changes"
          />
        }
      >
        {eventHits.length === 0 ? (
          <p className="px-3.5 py-3 text-[12px] text-muted">
            {rangeEvents.length === 0
              ? 'No task changes in this range.'
              : 'No changes match this filter.'}
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {eventHits.map((e) => (
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
                    onClick={() => openTask(e.taskKey)}
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
  );
}
