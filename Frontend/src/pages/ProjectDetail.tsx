import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Columns3Icon, FileTextIcon, ListIcon, PlusIcon } from 'lucide-react';
import { DetailHeader } from '../components/ui/DetailHeader';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProductMark } from '../components/ui/ProductMark';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Avatar } from '../components/ui/Avatar';
import { Segmented } from '../components/ui/Segmented';
import { Button } from '../components/ui/Button';
import { NotFound } from '../components/ui/NotFound';
import { TaskBoard } from '../components/work/TaskBoard';
import { TaskList } from '../components/work/TaskList';
import { docs, projects, timelineWeeks } from '../data/work';
import { useWork } from '../contexts/WorkContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { memberById, productById, projectStatusMeta } from '../utils/status';

export function ProjectDetail() {
  const { projectId } = useParams();
  const [view, setView] = useState<'board' | 'list'>('board');
  const { tasks } = useWork();
  const { openCreateTask } = useWorkspaceUI();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return <NotFound what="Project" backTo="/projects" backLabel="Back to projects" />;

  const meta = projectStatusMeta[project.status];
  const items = tasks.filter((t) => t.projectId === project.id);
  const overdue = items.filter((t) => t.overdue).length;
  const people = Array.from(new Set(items.map((t) => t.assignee)));
  const doneCount = items.filter((t) => t.status === 'done').length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const milestoneDate =
    timelineWeeks[Math.min(Math.floor(project.milestone.week), timelineWeeks.length - 1)];

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[
          { label: 'Projects', to: '/projects' },
          { label: productById(project.product).name, to: `/products/${project.product}` },
          { label: project.name },
        ]}
        leading={<ProductMark product={project.product} size="lg" />}
        title={project.name}
        eyebrow={productById(project.product).name}
        badges={
          <>
            <StatusBadge tone={meta.tone} label={meta.label} dot />
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <Avatar id={project.lead} size="xs" /> Led by {memberById(project.lead).name}
            </span>
          </>
        }
        actions={
          <Button
            variant="primary"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={() => openCreateTask({ projectId: project.id, product: project.product })}
          >
            New task
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
        <div className="bg-white px-3.5 py-2.5">
          <p className="text-[11.5px] text-muted">Progress</p>
          <p className="text-[18px] font-semibold tabular-nums text-ink">{pct}%</p>
          <ProgressBar
            className="mt-1"
            value={pct}
            tone={meta.tone === 'ok' ? 'accent' : meta.tone}
            label="Project progress"
          />
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <p className="text-[11.5px] text-muted">Tasks done</p>
          <p className="text-[18px] font-semibold tabular-nums text-ink">
            {doneCount}
            <span className="text-[13px] text-muted">/{items.length}</span>
          </p>
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <p className="text-[11.5px] text-muted">Overdue</p>
          <p
            className={`text-[18px] font-semibold tabular-nums ${overdue ? 'text-bad' : 'text-ink'}`}
          >
            {overdue}
          </p>
        </div>
        <div className="bg-white px-3.5 py-2.5">
          <p className="text-[11.5px] text-muted">Milestone</p>
          <p className="truncate text-[15px] font-semibold text-ink">{project.milestone.name}</p>
          <p className="text-[11.5px] text-subtle">Week of {milestoneDate}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-3">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: 'Board', icon: <Columns3Icon className="h-3.5 w-3.5" /> },
              { value: 'list', label: 'List', icon: <ListIcon className="h-3.5 w-3.5" /> },
            ]}
          />

          {view === 'board' ? (
            <TaskBoard tasks={items} projectId={project.id} />
          ) : (
            <TaskList tasks={items} />
          )}
        </div>
        <div className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Panel title="Objective">
            <p className="px-3.5 py-3 text-[13px] leading-relaxed text-ink">{project.objective}</p>
          </Panel>
          <Panel title="People" meta={<span>{people.length}</span>}>
            <ul className="divide-y divide-line">
              {people.map((id) => (
                <li key={id}>
                  <Link
                    to={`/team/${id}`}
                    className="flex items-center gap-2 px-3.5 py-2 hover:bg-sunken/50"
                  >
                    <Avatar id={id} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                      {memberById(id).name}
                    </span>
                    <span className="text-[11.5px] text-muted">
                      {items.filter((t) => t.assignee === id).length} tasks
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Documents">
            <ul className="divide-y divide-line">
              {docs
                .filter((d) => d.product === project.product)
                .map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-3.5 py-2">
                    <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                      {d.title}
                    </span>
                    <span className="text-[11px] text-subtle">{d.kind}</span>
                  </li>
                ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
