import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, ScaleIcon, UserPlusIcon } from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { PageHero } from '../components/ui/PageHero';
import { Segmented } from '../components/ui/Segmented';
import { FilterBar } from '../components/filters/FilterBar';
import { TeamBoardIllustration } from '../components/illustrations/TeamBoardIllustration';
import { AssignTaskModal } from '../components/work/AssignTaskModal';
import { WorkloadTable, type WorkloadRow } from '../components/assignments/WorkloadTable';
import { AssignmentAnalytics } from '../components/assignments/AssignmentAnalytics';
import { RebalanceModal } from '../components/assignments/RebalanceModal';
import { useWork } from '../contexts/WorkContext';
import { useDateRange } from '../contexts/DateRangeContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { useAuth } from '../contexts/AuthContext';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { useDirectory } from '../components/team/useDirectory';
import { useTaskInsights } from '../components/work/useTaskInsights';
import { TaskInsightBadge } from '../components/work/TaskInsightBadge';
import { formatDateTime, relative } from '../utils/date';
import { describeEvent } from '../utils/taskEvents';
import type { Task } from '../types/work';

const keys = ['q', 'role', 'product', 'person', 'over', 'sort'] as const;
type Tab = 'reviewer' | 'history';

export function Assignments() {
  const { tasks, events, timeLogs } = useWork();
  const { inRange, label } = useDateRange();
  const { matches, matchesTask, allowedProducts } = useProductFilter();
  const { openCreateTask } = useWorkspaceUI();
  const { canDo } = useAuth();
  const { members, memberById } = useDirectory();
  const firstName = (id: string) => memberById(id).name.split(' ')[0];
  const f = useUrlFilters(keys);
  const v = f.values;
  const [tab, setTab] = useState<Tab>('reviewer');
  const [rebalance, setRebalance] = useState(false);
  const [assigning, setAssigning] = useState<{ task: Task; field: 'assignee' | 'reviewer' } | null>(
    null,
  );
  const canAssign = canDo('task:assign');

  const scopedTasks = useMemo(
    () => tasks.filter((t) => matchesTask(t) && (!v.product || t.product === v.product)),
    [tasks, matchesTask, v.product],
  );

  const allRows = useMemo<WorkloadRow[]>(
    () =>
      members
        .filter((m) => m.status === 'active' && m.products.some(matches))
        .map((m) => {
          const mine = scopedTasks.filter((t) => t.assignee === m.id);
          const open = mine.filter((t) => t.status !== 'done');
          return {
            m,
            open,
            load: open.reduce((s, t) => s + t.estimate, 0),
            backlog: open.filter((t) => t.status === 'backlog').length,
            progress: open.filter((t) => t.status === 'in-progress').length,
            review: open.filter((t) => t.status === 'review').length,
            overdue: open.filter((t) => t.overdue).length,
            doneInRange: mine.filter((t) =>
              events.some(
                (e) =>
                  e.taskKey === t.key &&
                  e.kind === 'status' &&
                  e.to === 'done' &&
                  inRange(new Date(e.at)),
              ),
            ).length,
            logged: timeLogs
              .filter((l) => l.member === m.id && inRange(new Date(l.at)))
              .reduce((s, l) => s + l.minutes, 0),
          };
        }),
    [members, scopedTasks, events, timeLogs, inRange, matches],
  );

  const rows = useMemo(() => {
    const list = allRows.filter(
      (r) =>
        (!v.q || r.m.name.toLowerCase().includes(v.q.toLowerCase())) &&
        (!v.role || r.m.role === v.role) &&
        (!v.product || r.m.products.includes(v.product as Task['product'])) &&
        (!v.person || r.m.id === v.person) &&
        (!v.over || r.load > r.m.capacity),
    );
    const sort = v.sort || 'load';
    return list.sort((a, b) =>
      sort === 'name'
        ? a.m.name.localeCompare(b.m.name)
        : sort === 'overdue'
          ? b.overdue - a.overdue
          : b.load / b.m.capacity - a.load / a.m.capacity,
    );
  }, [allRows, v]);

  const visibleIds = new Set(rows.map((r) => r.m.id));
  const analyticsTasks = scopedTasks.filter((t) => visibleIds.has(t.assignee));
  const history = events
    .filter(
      (e) =>
        (e.kind === 'assignee' || e.kind === 'reviewer') &&
        inRange(new Date(e.at)) &&
        scopedTasks.some((t) => t.key === e.taskKey),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const needsReviewer = scopedTasks.filter(
    (t) => (t.status === 'review' || t.status === 'in-progress') && !t.reviewer,
  );
  const overCap = allRows.filter((r) => r.load > r.m.capacity).length;
  const insights = useTaskInsights(needsReviewer.map((t) => t.key));
  const apply = useCallback(
    (vals: Record<string, string>) =>
      f.setMany(Object.fromEntries(keys.map((k) => [k, vals[k] ?? '']))),
    [f],
  );

  return (
    <div className="space-y-3.5">
      <PageHero
        tint="neutral"
        illustration={<TeamBoardIllustration className="h-[84px] w-auto" />}
        title="Assignments"
        description="Who owns what, how loaded they are, and every assignment change with who made it and when."
        actions={
          canAssign ? (
            <>
              <Button
                size="sm"
                variant="primary"
                icon={<PlusIcon className="h-3.5 w-3.5" />}
                onClick={() => openCreateTask()}
              >
                Create & assign
              </Button>
              <Button
                size="sm"
                icon={<ScaleIcon className="h-3.5 w-3.5" />}
                onClick={() => setRebalance(true)}
              >
                Rebalance
              </Button>
            </>
          ) : undefined
        }
        stats={[
          { label: 'People', value: allRows.length },
          { label: 'Open points', value: allRows.reduce((s, r) => s + r.load, 0) },
          { label: 'Over capacity', value: overCap, tone: overCap ? 'bad' : undefined },
          {
            label: 'Need reviewer',
            value: needsReviewer.length,
            tone: needsReviewer.length ? 'warn' : undefined,
          },
          { label: `Changes · ${label.toLowerCase()}`, value: history.length },
        ]}
      />

      <FilterBar
        id="assignments"
        values={v}
        onChange={(k, val) => f.set(k as (typeof keys)[number], val)}
        onApply={apply}
        onReset={f.reset}
        activeCount={f.activeCount}
        count={rows.length}
        noun="people"
        search={{ key: 'q', placeholder: 'Search people…' }}
        selects={[
          {
            key: 'role',
            label: 'Role',
            options: ['Project manager', 'Developer', 'Designer', 'Tester', 'Operations'].map(
              (r) => ({ value: r, label: r }),
            ),
          },
          {
            key: 'product',
            label: 'Product',
            options: allowedProducts.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            key: 'person',
            label: 'Person',
            options: allRows.map((r) => ({ value: r.m.id, label: r.m.name })),
          },
          {
            key: 'sort',
            label: 'Sort',
            options: [
              { value: 'overdue', label: 'Most overdue' },
              { value: 'name', label: 'Name' },
            ],
          },
        ]}
        toggles={[{ key: 'over', label: 'Over capacity' }]}
        presets={[
          { label: 'Overloaded developers', values: { role: 'Developer', over: '1' } },
          { label: 'Overdue first', values: { sort: 'overdue' } },
        ]}
      />

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3.5">
          <Panel
            title="Team workload"
            meta={
              <span className="hidden sm:inline">
                Load = open estimate points vs weekly capacity
              </span>
            }
          >
            <WorkloadTable
              rows={rows}
              canAssign={canAssign}
              onReassign={(t) => setAssigning({ task: t, field: 'assignee' })}
            />
          </Panel>

          <section className="overflow-hidden rounded-lg border border-line bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2">
              <Segmented
                label="Assignment view"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'reviewer', label: `Needs a reviewer · ${needsReviewer.length}` },
                  { value: 'history', label: `Assignment history · ${history.length}` },
                ]}
              />

              <span className="text-[11.5px] text-muted">{label}</span>
            </header>
            {tab === 'reviewer' ? (
              needsReviewer.length === 0 ? (
                <p className="px-3.5 py-4 text-[12.5px] text-muted">
                  Every active task has a reviewer.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {needsReviewer.map((t) => (
                    <li
                      key={t.key}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_140px_80px_auto]"
                    >
                      <Link
                        to={`/tasks/${t.key}`}
                        className="min-w-0 truncate text-[12.5px] hover:underline"
                      >
                        <span className="font-mono text-[11.5px] text-muted">{t.key}</span>{' '}
                        <span className="font-medium text-ink">{t.title}</span>
                        {insights.available && (
                          <span className="ml-1.5 align-middle">
                            <TaskInsightBadge insight={insights.get(t.key)} />
                          </span>
                        )}
                      </Link>
                      <span className="hidden items-center gap-1.5 text-[12px] text-ink sm:flex">
                        <Avatar id={t.assignee} size="xs" />
                        {firstName(t.assignee)}
                      </span>
                      <span
                        className={`hidden text-[12px] tabular-nums sm:block ${t.overdue ? 'font-semibold text-bad' : 'text-ink'}`}
                      >
                        {t.due}
                      </span>
                      {canAssign ? (
                        <Button
                          size="sm"
                          icon={<UserPlusIcon className="h-3.5 w-3.5" />}
                          onClick={() => setAssigning({ task: t, field: 'reviewer' })}
                        >
                          Set reviewer
                        </Button>
                      ) : (
                        <span />
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : history.length === 0 ? (
              <p className="px-3.5 py-4 text-[12.5px] text-muted">
                No assignment changes in this range.
              </p>
            ) : (
              <ol className="max-h-[420px] divide-y divide-line overflow-y-auto scroll-thin">
                {history.map((e) => (
                  <li
                    key={e.id}
                    className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 px-3.5 py-2"
                  >
                    <Avatar id={e.actor} size="xs" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-ink">
                        <span className="font-semibold">{firstName(e.actor)}</span>{' '}
                        <span className="text-muted">{describeEvent(e)}</span> on{' '}
                        <Link
                          to={`/tasks/${e.taskKey}`}
                          className="font-mono font-medium text-accent hover:underline"
                        >
                          {e.taskKey}
                        </Link>
                      </p>
                      {e.note && (
                        <p className="mt-0.5 text-[11.5px] italic text-muted">“{e.note}”</p>
                      )}
                    </div>
                    <time
                      className="whitespace-nowrap text-[11.5px] tabular-nums text-muted"
                      title={relative(new Date(e.at))}
                    >
                      {formatDateTime(new Date(e.at))}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <AssignmentAnalytics tasks={analyticsTasks} />
      </div>

      <AssignTaskModal
        task={assigning?.task ?? null}
        field={assigning?.field}
        onClose={() => setAssigning(null)}
      />
      <RebalanceModal open={rebalance} onClose={() => setRebalance(false)} />
    </div>
  );
}
