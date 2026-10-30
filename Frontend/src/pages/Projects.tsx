import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRightIcon,
  CalendarRangeIcon,
  Columns3Icon,
  ListIcon,
  PlusIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Segmented';
import { ProductMark } from '../components/ui/ProductMark';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { TaskBoard } from '../components/work/TaskBoard';
import { TaskList } from '../components/work/TaskList';
import { ProjectTimeline } from '../components/work/ProjectTimeline';
import { TaskFilterBar, useTaskFilters } from '../components/work/TaskFilterBar';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useDateRange } from '../contexts/DateRangeContext';
import { useTaskInRange, useWork } from '../contexts/WorkContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { projects } from '../data/work';
import { projectStatusMeta } from '../utils/status';

type View = 'board' | 'list' | 'timeline';

export function Projects() {
  const { matchesTask, matchesProject } = useProductFilter();
  const { inRange, label } = useDateRange();
  const { tasks } = useWork();
  const taskInRange = useTaskInRange();
  const { openCreateTask } = useWorkspaceUI();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) || 'board';
  const [projectId, setProjectId] = useState<string>('all');
  const { filters, setFilters, apply, active, reset } = useTaskFilters();

  const visibleProjects = projects.filter((p) => matchesProject(p.id, p.product));
  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          matchesTask(t) &&
          (projectId === 'all' || t.projectId === projectId) &&
          taskInRange(t, inRange) &&
          apply(t),
      ),
    [tasks, matchesTask, projectId, taskInRange, inRange, apply],
  );

  const progress = (id: string) => {
    const list = tasks.filter((t) => t.projectId === id);
    const done = list.filter((t) => t.status === 'done').length;
    return { done, total: list.length };
  };

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Projects"
        description={`Tasks created, changed or due in ${label.toLowerCase()}. Drag cards between columns — every move is recorded.`}
        actions={
          <>
            <Segmented<View>
              label="View"
              value={view}
              onChange={(v) => setParams(v === 'board' ? {} : { view: v })}
              options={[
                { value: 'board', label: 'Board', icon: <Columns3Icon className="h-3.5 w-3.5" /> },
                { value: 'list', label: 'List', icon: <ListIcon className="h-3.5 w-3.5" /> },
                {
                  value: 'timeline',
                  label: 'Timeline',
                  icon: <CalendarRangeIcon className="h-3.5 w-3.5" />,
                },
              ]}
            />

            <Button
              variant="primary"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => openCreateTask(projectId !== 'all' ? { projectId } : undefined)}
            >
              New task
            </Button>
          </>
        }
      />

      {view === 'timeline' ? (
        <ProjectTimeline items={visibleProjects} />
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setProjectId('all')}
              aria-pressed={projectId === 'all'}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors duration-150 ${
                projectId === 'all'
                  ? 'border-ink bg-sunken/40'
                  : 'border-line hover:border-line-strong'
              }`}
            >
              <span className="text-[12.5px] font-semibold text-ink">All projects</span>
              <span className="rounded bg-sunken px-1.5 text-[11px] font-medium tabular-nums text-muted">
                {visibleProjects.length}
              </span>
            </button>
            {visibleProjects.map((p) => {
              const meta = projectStatusMeta[p.status];
              const prog = progress(p.id);
              const active = projectId === p.id;
              return (
                <div
                  key={p.id}
                  className={`relative w-56 shrink-0 rounded-lg border transition-colors duration-150 ${active ? 'border-ink bg-sunken/40' : 'border-line hover:border-line-strong'}`}
                >
                  <button
                    onClick={() => setProjectId(active ? 'all' : p.id)}
                    aria-pressed={active}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-2.5 py-2 pr-7 text-left"
                  >
                    <ProductMark product={p.product} size="sm" />
                    <span className="truncate text-[12.5px] font-semibold text-ink">{p.name}</span>
                    <Avatar id={p.lead} size="xs" />
                    <span className="col-span-3 flex items-center gap-2">
                      <StatusBadge tone={meta.tone} label={meta.label} />
                      <ProgressBar
                        className="flex-1"
                        value={prog.total ? (prog.done / prog.total) * 100 : 0}
                        tone={meta.tone === 'ok' ? 'accent' : meta.tone}
                        label={`${p.name} progress`}
                      />
                      <span className="text-[11px] tabular-nums text-muted">
                        {prog.done}/{prog.total}
                      </span>
                    </span>
                  </button>
                  <Link
                    to={`/projects/${p.id}`}
                    className="absolute right-1 top-1.5 rounded p-1 text-muted hover:bg-sunken hover:text-ink"
                    aria-label={`Open ${p.name}`}
                  >
                    <ArrowUpRightIcon className="h-3.5 w-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>

          <TaskFilterBar
            filters={filters}
            setFilters={setFilters}
            active={active}
            reset={reset}
            count={visibleTasks.length}
          />

          {view === 'board' ? (
            <TaskBoard
              tasks={visibleTasks}
              projectId={projectId !== 'all' ? projectId : undefined}
            />
          ) : (
            <TaskList
              tasks={visibleTasks}
              emptyLabel={`No tasks were created, changed or due in ${label.toLowerCase()}.`}
            />
          )}
        </>
      )}
    </div>
  );
}
