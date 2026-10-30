import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ClockIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LinkIcon,
  LockIcon,
  PlusIcon,
  UserRoundPenIcon,
} from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { ChecklistIllustration } from '../components/illustrations/ChecklistIllustration';
import { useAuth } from '../contexts/AuthContext';
import { currentUserId } from '../data/team';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { NotFound } from '../components/ui/NotFound';
import { ProgressBar } from '../components/ui/ProgressBar';
import { TraceChain } from '../components/work/TraceChain';
import { AssignTaskModal } from '../components/work/AssignTaskModal';
import { LogTimeModal } from '../components/work/LogTimeModal';
import { TaskTimeline } from '../components/work/TaskTimeline';
import { useWork } from '../contexts/WorkContext';
import { projects } from '../data/work';
import { pullRequests, traces } from '../data/engineering';
import {
  ciMeta,
  firstName,
  memberById,
  priorityMeta,
  productById,
  reviewMeta,
  taskStatusMeta,
} from '../utils/status';
import {
  formatDateTime,
  formatDay,
  fromInputDate,
  parseWhen,
  relative,
  toInputDate,
} from '../utils/date';
import { formatMinutes } from '../utils/taskEvents';
import type { Priority, Task, TaskStatus } from '../types/work';

const cellLabel = 'text-[11px] font-medium text-muted';
const inlineSelect =
  'mt-0.5 h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1 -mx-1 text-[12.5px] font-semibold text-ink hover:border-line focus:border-accent';

export function TaskDetail() {
  const { taskKey } = useParams();
  const { tasks, events, subtasks, timeLogs, updateTask, addSubtask, toggleSubtask } = useWork();
  const task = tasks.find((t) => t.key === taskKey);
  const [assignField, setAssignField] = useState<'assignee' | 'reviewer' | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [newSub, setNewSub] = useState('');
  const [watching, setWatching] = useState(true);
  const { canDo, canSeeProduct } = useAuth();
  const canAssign = canDo('task:assign');

  if (!task || !canSeeProduct(task.product))
    return <NotFound what="Task" backTo="/projects" backLabel="Back to projects" />;

  const project = projects.find((p) => p.id === task.projectId);
  const pr = task.pr ? pullRequests.find((p) => p.number === task.pr) : undefined;
  const trace = traces.find((t) => t.taskKey === task.key);
  const blocker = task.blockedBy ? tasks.find((t) => t.key === task.blockedBy) : undefined;
  const subs = subtasks.filter((s) => s.taskKey === task.key);
  const subsDone = subs.filter((s) => s.done).length;
  const logs = timeLogs.filter((l) => l.taskKey === task.key);
  const logged = logs.reduce((s, l) => s + l.minutes, 0);
  const budget = task.estimate * 120;
  const taskEvents = events.filter((e) => e.taskKey === task.key);
  const assignedEvent = [...taskEvents].reverse().find((e) => e.kind === 'assignee');
  const lastEvent = [...taskEvents].sort((a, b) => b.at.localeCompare(a.at))[0];
  const byPerson = Object.entries(
    logs.reduce<Record<string, number>>(
      (acc, l) => ({ ...acc, [l.member]: (acc[l.member] ?? 0) + l.minutes }),
      {},
    ),
  ).sort((a, b) => b[1] - a[1]);
  const maxPerson = Math.max(1, ...byPerson.map(([, m]) => m));
  const related = tasks
    .filter((t) => t.projectId === task.projectId && t.key !== task.key && t.status !== 'done')
    .slice(0, 5);
  const baseWatchers = Array.from(
    new Set(
      [
        task.createdBy,
        task.assignee,
        task.reviewer,
        ...taskEvents.filter((e) => e.kind === 'comment').map((e) => e.actor),
      ].filter((x): x is string => !!x),
    ),
  );
  const watchers = watching
    ? Array.from(new Set([...baseWatchers, currentUserId]))
    : baseWatchers.filter((id) => id !== currentUserId);

  const changeStatus = (s: TaskStatus) => {
    if (s === 'done' && pr && pr.review !== 'merged') {
      toast.error('Can’t mark as Done yet', {
        description: `PR #${pr.number} isn’t merged and released. Done requires a production deploy.`,
      });
      return;
    }
    if (s === 'done' && subsDone < subs.length) {
      toast.error('Finish the subtasks first', {
        description: `${subs.length - subsDone} subtask${subs.length - subsDone > 1 ? 's are' : ' is'} still open.`,
      });
      return;
    }
    updateTask(task.key, { status: s });
    toast.success(`${task.key} → ${taskStatusMeta[s].label}`, {
      description: 'Recorded in the task history.',
    });
  };

  return (
    <div className="space-y-3.5">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 text-[12px] text-muted"
      >
        <Link to="/projects" className="hover:text-ink hover:underline">
          Projects
        </Link>
        <span className="text-line-strong">/</span>
        <Link
          to={`/projects/${task.projectId}`}
          className="truncate hover:text-ink hover:underline"
        >
          {project?.name ?? 'Project'}
        </Link>
        <span className="text-line-strong">/</span>
        <span className="font-mono font-medium text-ink">{task.key}</span>
      </nav>
      <PageHero
        tint={task.overdue ? 'bad' : task.status === 'done' ? 'neutral' : 'accent'}
        illustration={<ChecklistIllustration className="h-[84px] w-auto" />}
        eyebrow={
          <>
            <ProductMark product={task.product} size="sm" />
            <span className="font-mono">{task.key}</span> · {productById(task.product).name}
            {task.createdBy && task.createdAt && (
              <span className="hidden truncate sm:inline">
                · created by {firstName(task.createdBy)} on {formatDay(new Date(task.createdAt))}
              </span>
            )}
          </>
        }
        stats={[
          { label: 'Subtasks', value: `${subsDone}/${subs.length}` },
          {
            label: 'Logged',
            value: formatMinutes(logged),
            tone: logged > budget ? 'bad' : undefined,
          },
          { label: 'Comments', value: task.comments },
          { label: 'Events', value: taskEvents.length },
        ]}
        title={task.title}
        badges={
          <>
            <StatusBadge {...taskStatusMeta[task.status]} dot />
            <StatusBadge {...priorityMeta[task.priority]} />
            <StatusBadge tone="neutral" label={task.type[0].toUpperCase() + task.type.slice(1)} />
            {task.overdue && <StatusBadge tone="bad" label={`Overdue · ${task.due}`} />}
          </>
        }
        actions={
          <>
            {canAssign && (
              <Button
                size="sm"
                variant="primary"
                icon={<UserRoundPenIcon className="h-3.5 w-3.5" />}
                onClick={() => setAssignField('assignee')}
              >
                Assign
              </Button>
            )}
            <Button
              size="sm"
              icon={<LinkIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href);
                toast.success('Link copied');
              }}
            >
              Copy link
            </Button>
            <Button
              size="sm"
              icon={<ClockIcon className="h-3.5 w-3.5" />}
              onClick={() => setLogOpen(true)}
            >
              Log time
            </Button>
            {pr && (
              <Link
                to={`/pull-requests/${pr.number}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink hover:border-line-strong"
              >
                <GitPullRequestIcon className="h-3.5 w-3.5" /> PR #{pr.number}
              </Link>
            )}
          </>
        }
      />

      <PropertyStrip
        task={task}
        logged={logged}
        budget={budget}
        lastActor={lastEvent?.actor}
        lastAt={lastEvent?.at}
        onAssign={setAssignField}
        onStatus={changeStatus}
      />

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_288px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3.5">
          <Panel title="Description">
            <div className="px-3.5 py-3 text-[13px] leading-relaxed text-ink">
              {task.description ?? (
                <span className="text-muted">
                  No description yet. Add requirements so reviewers know what “done” means.
                </span>
              )}
              {blocker && (
                <Link
                  to={`/tasks/${blocker.key}`}
                  className="mt-3 flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-[12.5px] font-medium text-warn hover:underline"
                >
                  <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Blocked by {blocker.key} · {blocker.title} ({taskStatusMeta[blocker.status].label}
                  )
                </Link>
              )}
            </div>
          </Panel>

          <Panel
            title="Subtasks"
            meta={
              <span className="tabular-nums">
                {subsDone}/{subs.length} done
              </span>
            }
          >
            {subs.length > 0 && (
              <ProgressBar
                className="mx-3.5 mt-2.5"
                value={(subsDone / subs.length) * 100}
                tone="ok"
                label="Subtask progress"
              />
            )}
            <ul className="mt-1 divide-y divide-line">
              {subs.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5 px-3.5 py-1.5">
                  <input
                    type="checkbox"
                    checked={s.done}
                    onChange={() => toggleSubtask(s.id)}
                    aria-label={s.title}
                    className="h-3.5 w-3.5 shrink-0 accent-[#137333]"
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-[12.5px] ${s.done ? 'text-muted line-through' : 'text-ink'}`}
                  >
                    {s.title}
                  </span>
                  {s.done && s.doneBy && s.doneAt && (
                    <span
                      className="flex shrink-0 items-center gap-1 text-[11px] text-muted"
                      title={formatDateTime(new Date(s.doneAt))}
                    >
                      <Avatar id={s.doneBy} size="xs" />
                      <span className="hidden sm:inline">{relative(new Date(s.doneAt))}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newSub.trim()) return;
                addSubtask(task.key, newSub.trim());
                setNewSub('');
              }}
              className="flex items-center gap-2 border-t border-line px-3.5 py-2"
            >
              <PlusIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
              <input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="Add a subtask and press Enter"
                aria-label="New subtask"
                className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-subtle"
              />
            </form>
          </Panel>

          <Panel title="Task to production" meta={<span>Each state tracked separately</span>}>
            {trace ? (
              <div className="px-3.5 pb-2.5 pt-3">
                <TraceChain steps={trace.steps} />
                <p className="mt-2 text-[12px] text-muted">{trace.note}</p>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12.5px] text-muted">
                  No code linked. Name a branch after the task and the GitHub App links it
                  automatically.
                </p>
                <Button
                  size="sm"
                  icon={<GitBranchIcon className="h-3.5 w-3.5" />}
                  onClick={() => {
                    navigator.clipboard?.writeText(`feat/${task.key.toLowerCase()}`);
                    toast.success('Branch name copied', {
                      description: `feat/${task.key.toLowerCase()}`,
                    });
                  }}
                >
                  Copy branch name
                </Button>
              </div>
            )}
            {pr && (
              <Link
                to={`/pull-requests/${pr.number}`}
                className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2 hover:bg-sunken/50"
              >
                <GitPullRequestIcon className="h-3.5 w-3.5 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                  #{pr.number} {pr.title}
                </span>
                <StatusBadge {...ciMeta[pr.ci]} dot />
                <StatusBadge {...reviewMeta[pr.review]} />
              </Link>
            )}
          </Panel>

          <TaskTimeline taskKey={task.key} />
        </div>

        <div className="grid content-start gap-3.5 sm:grid-cols-2 lg:grid-cols-1">
          <Panel title="Accountability">
            <dl className="divide-y divide-line text-[12.5px]">
              <Row label="Created" actor={task.createdBy} when={task.createdAt} />
              <Row label="Assigned" actor={assignedEvent?.actor} when={assignedEvent?.at} />
              <Row label="Last change" actor={lastEvent?.actor} when={lastEvent?.at} />
            </dl>
          </Panel>

          <Panel
            title="Time tracked"
            meta={
              <span className="tabular-nums">
                {formatMinutes(logged)} of ~{formatMinutes(budget)}
              </span>
            }
            action={
              <button
                onClick={() => setLogOpen(true)}
                className="font-medium text-accent hover:underline"
              >
                Log
              </button>
            }
          >
            {byPerson.length === 0 ? (
              <p className="px-3.5 py-3 text-[12.5px] text-muted">No time logged yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {byPerson.map(([id, min]) => (
                  <li
                    key={id}
                    className="grid grid-cols-[18px_80px_minmax(0,1fr)_52px] items-center gap-2 px-3.5 py-1.5"
                  >
                    <Avatar id={id} size="xs" />
                    <span className="truncate text-[12px] text-ink">{firstName(id)}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${(min / maxPerson) * 100}%` }}
                      />
                    </span>
                    <span className="text-right text-[12px] font-semibold tabular-nums text-ink">
                      {formatMinutes(min)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Context">
            <dl className="divide-y divide-line text-[12.5px]">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2">
                <dt className="text-muted">Project</dt>
                <dd className="min-w-0 truncate font-medium">
                  <Link to={`/projects/${task.projectId}`} className="text-ink hover:underline">
                    {project?.name}
                  </Link>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 px-3.5 py-2">
                <dt className="text-muted">Product</dt>
                <dd>
                  <Link
                    to={`/products/${task.product}`}
                    className="flex items-center gap-1.5 font-medium text-ink hover:underline"
                  >
                    <ProductMark product={task.product} size="sm" />
                    {productById(task.product).name}
                  </Link>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 px-3.5 py-2">
                <dt className="text-muted">Milestone</dt>
                <dd className="font-medium text-ink">{project?.milestone.name}</dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="Related in project"
            meta={<span className="tabular-nums">{related.length}</span>}
          >
            {related.length === 0 ? (
              <p className="px-3.5 py-3 text-[12.5px] text-muted">
                No other open tasks in this project.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {related.map((t) => (
                  <li key={t.key}>
                    <Link
                      to={`/tasks/${t.key}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3.5 py-1.5 hover:bg-sunken/50"
                    >
                      <span className="min-w-0 truncate text-[12px]">
                        <span className="font-mono text-[11px] text-muted">{t.key}</span>{' '}
                        <span className="font-medium text-ink">{t.title}</span>
                      </span>
                      <Avatar id={t.assignee} size="xs" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Watchers"
            meta={<span className="tabular-nums">{watchers.length}</span>}
            action={
              <button
                onClick={() => {
                  setWatching((w) => !w);
                  toast.success(watching ? 'Stopped watching' : 'You’ll be notified of changes');
                }}
                className="font-medium text-accent hover:underline"
              >
                {watching ? 'Unwatch' : 'Watch'}
              </button>
            }
          >
            <ul className="flex flex-wrap gap-1.5 px-3.5 py-2.5">
              {watchers.map((id) => (
                <li key={id}>
                  <Link
                    to={`/team/${id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2 text-[11.5px] font-medium text-ink hover:border-line-strong"
                  >
                    <Avatar id={id} size="xs" />
                    {firstName(id)}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <AssignTaskModal
        task={assignField ? task : null}
        field={assignField ?? 'assignee'}
        onClose={() => setAssignField(null)}
      />
      <LogTimeModal taskKey={logOpen ? task.key : null} onClose={() => setLogOpen(false)} />
    </div>
  );
}

function PropertyStrip({
  task,
  logged,
  budget,
  lastActor,
  lastAt,
  onAssign,
  onStatus,
}: {
  task: Task;
  logged: number;
  budget: number;
  lastActor?: string;
  lastAt?: string;
  onAssign: (f: 'assignee' | 'reviewer') => void;
  onStatus: (s: TaskStatus) => void;
}) {
  const { updateTask } = useWork();
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 2xl:grid-cols-8">
      <div className="min-w-0 bg-white px-3 py-2">
        <label className={cellLabel} htmlFor="task-status">
          Status
        </label>
        <select
          id="task-status"
          value={task.status}
          onChange={(e) => onStatus(e.target.value as TaskStatus)}
          className={inlineSelect}
        >
          {(Object.keys(taskStatusMeta) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {taskStatusMeta[s].label}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={() => onAssign('assignee')}
        className="group min-w-0 bg-white px-3 py-2 text-left hover:bg-sunken/50"
      >
        <span className={cellLabel}>Assignee</span>
        <span className="mt-0.5 flex h-7 items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Avatar id={task.assignee} size="xs" />
          <span className="truncate">{memberById(task.assignee).name}</span>
          <UserRoundPenIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
        </span>
      </button>
      <button
        onClick={() => onAssign('reviewer')}
        className="group min-w-0 bg-white px-3 py-2 text-left hover:bg-sunken/50"
      >
        <span className={cellLabel}>Reviewer</span>
        <span className="mt-0.5 flex h-7 items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          {task.reviewer ? <Avatar id={task.reviewer} size="xs" /> : null}
          <span className={`truncate ${task.reviewer ? '' : 'font-medium text-muted'}`}>
            {task.reviewer ? memberById(task.reviewer).name : 'Add reviewer'}
          </span>
        </span>
      </button>
      <div className="min-w-0 bg-white px-3 py-2">
        <label className={cellLabel} htmlFor="task-priority">
          Priority
        </label>
        <select
          id="task-priority"
          value={task.priority}
          onChange={(e) => updateTask(task.key, { priority: e.target.value as Priority })}
          className={inlineSelect}
        >
          {(Object.keys(priorityMeta) as Priority[]).map((p) => (
            <option key={p} value={p}>
              {priorityMeta[p].label}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 bg-white px-3 py-2">
        <label className={cellLabel} htmlFor="task-due">
          Due date
        </label>
        <input
          id="task-due"
          type="date"
          value={toInputDate(parseWhen(task.due))}
          onChange={(e) =>
            e.target.value &&
            updateTask(task.key, { due: formatDay(fromInputDate(e.target.value)) })
          }
          className={`${inlineSelect} ${task.overdue ? 'text-bad' : ''}`}
        />
      </div>
      <div className="min-w-0 bg-white px-3 py-2">
        <label className={cellLabel} htmlFor="task-estimate">
          Estimate
        </label>
        <select
          id="task-estimate"
          value={task.estimate}
          onChange={(e) => updateTask(task.key, { estimate: Number(e.target.value) })}
          className={inlineSelect}
        >
          {[1, 2, 3, 5, 8, 13].map((n) => (
            <option key={n} value={n}>
              {n} pts
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 bg-white px-3 py-2">
        <span className={cellLabel}>Time logged</span>
        <span
          className={`mt-0.5 flex h-7 items-center text-[12.5px] font-semibold tabular-nums ${logged > budget ? 'text-bad' : 'text-ink'}`}
        >
          {formatMinutes(logged)}{' '}
          <span className="ml-1 text-[11.5px] font-normal text-muted">
            / ~{formatMinutes(budget)}
          </span>
        </span>
      </div>
      <div className="min-w-0 bg-white px-3 py-2">
        <span className={cellLabel}>Last change</span>
        <span className="mt-0.5 flex h-7 min-w-0 items-center gap-1.5 text-[12.5px] text-ink">
          {lastActor ? (
            <>
              <Avatar id={lastActor} size="xs" />
              <span className="truncate font-semibold">{firstName(lastActor)}</span>
              {lastAt && (
                <span className="truncate text-[11.5px] text-muted">
                  {relative(new Date(lastAt))}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </span>
      </div>
    </div>
  );
}

function Row({ label, actor, when }: { label: string; actor?: string; when?: string }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 px-3.5 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        {actor ? (
          <>
            <Avatar id={actor} size="xs" />
            <span className="min-w-0 truncate">
              <Link to={`/team/${actor}`} className="font-medium text-ink hover:underline">
                {firstName(actor)}
              </Link>
              {when && (
                <span className="text-muted" title={formatDateTime(new Date(when))}>
                  {' '}
                  · {formatDateTime(new Date(when))}
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </dd>
    </div>
  );
}
