import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  BellIcon,
  CheckIcon,
  KeyRoundIcon,
  PlusIcon,
  RocketIcon,
  ShieldCheckIcon,
  UndoIcon,
} from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Segmented';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import { ChecklistIllustration } from '../components/illustrations/ChecklistIllustration';
import { EmptyIllustration } from '../components/illustrations/EmptyIllustration';
import { useReauth } from '../contexts/ReauthContext';
import { useWork } from '../contexts/WorkContext';
import { useDateRange } from '../contexts/DateRangeContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { approvals as initialApprovals, mentions, projects } from '../data/work';
import { currentUserId } from '../data/team';
import { useAuth } from '../contexts/AuthContext';
import { firstName, memberById, priorityMeta, taskStatusMeta } from '../utils/status';
import { NOW, addDays, formatDateTime, parseWhen, relative, startOfDay } from '../utils/date';
import { describeEvent, formatMinutes } from '../utils/taskEvents';
import type { Approval, Task, TaskStatus } from '../types/work';

const kindIcon: Record<Approval['kind'], React.ComponentType<{ className?: string }>> = {
  deploy: RocketIcon,
  access: KeyRoundIcon,
  release: UndoIcon,
};

const prefs = [
  {
    id: 'assigned',
    label: 'Tasks assigned to me',
    desc: 'When a task is assigned or reassigned',
    on: true,
  },
  { id: 'reviews', label: 'Review requests', desc: 'Pull requests waiting on my review', on: true },
  { id: 'due', label: 'Due-date reminders', desc: '24 hours before a task is due', on: true },
  {
    id: 'incidents',
    label: 'SEV1 & SEV2 incidents',
    desc: 'Across all products I can access',
    on: true,
  },
  { id: 'deploys', label: 'Failed deployments', desc: 'Production and staging only', on: true },
  {
    id: 'portfolio',
    label: 'Portfolio digest',
    desc: 'Weekly summary every Monday 09:00',
    on: true,
  },
  {
    id: 'comments',
    label: 'Every comment',
    desc: 'Usually noisy — mentions are always delivered',
    on: false,
  },
];

type Scope = 'mine' | 'by-me' | 'reviewing';

export function MyWork() {
  const { requestReauth } = useReauth();
  const { tasks, events, timeLogs, updateTask } = useWork();
  const { inRange, label } = useDateRange();
  const { matchesTask } = useProductFilter();
  const { openCreateTask } = useWorkspaceUI();
  const { canDo } = useAuth();
  const canApprove = canDo('deploy:approve');
  const [pending, setPending] = useState(() => (canApprove ? initialApprovals : []));
  const [settings, setSettings] = useState<Record<string, boolean>>(
    Object.fromEntries(prefs.map((p) => [p.id, p.on])),
  );
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('mine');

  const assignedByMe = useMemo(() => {
    const keys = new Set<string>();
    events
      .filter((e) => e.kind === 'assignee' && e.actor === currentUserId && e.to !== currentUserId)
      .forEach((e) => keys.add(e.taskKey));
    return tasks.filter((t) => keys.has(t.key) && t.assignee !== currentUserId);
  }, [events, tasks]);

  const lists: Record<Scope, Task[]> = {
    mine: tasks.filter((t) => t.assignee === currentUserId),
    'by-me': assignedByMe,
    reviewing: tasks.filter((t) => t.reviewer === currentUserId),
  };
  const scoped = lists[scope].filter((t) => matchesTask(t));
  const today = startOfDay(NOW);
  const weekEnd = addDays(today, 7);
  const open = scoped.filter((t) => t.status !== 'done');
  const groups = [
    { id: 'overdue', title: 'Overdue', tone: 'text-bad', items: open.filter((t) => t.overdue) },
    {
      id: 'week',
      title: 'Due in the next 7 days',
      tone: 'text-ink',
      items: open.filter((t) => !t.overdue && parseWhen(t.due) <= weekEnd),
    },
    {
      id: 'later',
      title: 'Later',
      tone: 'text-ink',
      items: open.filter((t) => parseWhen(t.due) > weekEnd),
    },
    {
      id: 'done',
      title: `Completed · ${label.toLowerCase()}`,
      tone: 'text-ok',
      items: scoped.filter(
        (t) =>
          t.status === 'done' &&
          events.some(
            (e) =>
              e.taskKey === t.key &&
              e.kind === 'status' &&
              e.to === 'done' &&
              inRange(new Date(e.at)),
          ),
      ),
    },
  ].filter((g) => g.items.length > 0);

  const myEvents = events
    .filter((e) => e.actor === currentUserId && inRange(new Date(e.at)))
    .sort((a, b) => b.at.localeCompare(a.at));
  const loggedMin = timeLogs
    .filter((l) => l.member === currentUserId && inRange(new Date(l.at)))
    .reduce((s, l) => s + l.minutes, 0);
  const mine = lists.mine;

  const stats = [
    { label: 'Overdue', value: mine.filter((t) => t.overdue).length, tone: 'text-bad' },
    {
      label: 'Due ≤ 7 days',
      value: mine.filter((t) => t.status !== 'done' && !t.overdue && parseWhen(t.due) <= weekEnd)
        .length,
      tone: 'text-ink',
    },
    {
      label: 'In progress',
      value: mine.filter((t) => t.status === 'in-progress').length,
      tone: 'text-ink',
    },
    { label: 'Approvals', value: pending.length, tone: pending.length ? 'text-warn' : 'text-ink' },
    { label: `Logged · ${label.toLowerCase()}`, value: formatMinutes(loggedMin), tone: 'text-ink' },
  ];

  const resolve = (a: Approval, approved: boolean) => {
    setPending((list) => list.filter((x) => x.id !== a.id));
    toast(approved ? 'Approved' : 'Declined', {
      description: `${a.title} · recorded in the audit log with your name and time`,
    });
  };

  return (
    <div className="space-y-3.5">
      <section className="grid items-center gap-3 overflow-hidden rounded-lg border border-line bg-accent-soft/40 px-3.5 py-3 md:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <ChecklistIllustration className="hidden h-[84px] w-auto md:block" />
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">My work</h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Approvals, tasks and mentions that need you. Open work always shows; completed work and
            activity follow the date range.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="primary"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => openCreateTask({ assignee: currentUserId })}
            >
              New task for me
            </Button>
            <Button
              size="sm"
              icon={<BellIcon className="h-3.5 w-3.5" />}
              onClick={() => setPrefsOpen(true)}
            >
              Notification settings
            </Button>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-5 md:col-span-2 xl:col-span-1">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 bg-white px-3 py-1.5">
              <dt className="truncate text-[11px] font-medium text-muted">{s.label}</dt>
              <dd className={`text-[16px] font-semibold tabular-nums ${s.tone}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3.5">
          {canApprove && (
            <Panel
              title="Waiting on your approval"
              meta={<span className="tabular-nums">{pending.length} pending</span>}
            >
              {pending.length === 0 ? (
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ok-soft text-ok">
                    <CheckIcon className="h-4 w-4" />
                  </span>
                  <p className="text-[12.5px] text-ink">
                    All approvals handled. New requests appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {pending.map((a) => {
                      const Icon = kindIcon[a.kind];
                      return (
                        <motion.li
                          key={a.id}
                          layout
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                          className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 overflow-hidden px-3.5 py-2 md:grid-cols-[28px_minmax(0,1fr)_150px_48px_auto]"
                        >
                          <span
                            className={`flex h-7 w-7 items-center justify-center rounded-md ${a.kind === 'release' ? 'bg-bad-soft text-bad' : 'bg-sunken text-ink'}`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                              <ProductMark product={a.product} size="sm" />
                              <span className="truncate">{a.title}</span>
                            </p>
                            <p className="truncate text-[11.5px] text-muted">{a.detail}</p>
                          </div>
                          <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-[12px] text-ink md:col-start-auto">
                            <Avatar id={a.requestedBy} size="xs" />
                            <span className="truncate">{memberById(a.requestedBy).name}</span>
                          </span>
                          <span className="hidden text-right text-[11.5px] tabular-nums text-muted md:block">
                            {a.ago}
                          </span>
                          <div className="col-start-2 flex gap-1.5 md:col-start-auto">
                            <Button size="sm" onClick={() => resolve(a, false)}>
                              Decline
                            </Button>
                            <Button
                              size="sm"
                              variant={a.kind === 'release' ? 'danger' : 'primary'}
                              icon={
                                a.kind === 'release' ? (
                                  <ShieldCheckIcon className="h-3.5 w-3.5" />
                                ) : undefined
                              }
                              onClick={() =>
                                a.kind === 'access'
                                  ? resolve(a, true)
                                  : requestReauth({
                                      title: a.title,
                                      description: a.detail,
                                      actionLabel: 'Verify & approve',
                                      onConfirm: () => resolve(a, true),
                                    })
                              }
                            >
                              {a.kind === 'release' ? 'Approve · MFA' : 'Approve'}
                            </Button>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </Panel>
          )}

          <Panel
            title="Tasks"
            action={
              <Segmented<Scope>
                label="Task scope"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'mine', label: 'Assigned to me', count: lists.mine.length },
                  { value: 'by-me', label: 'Assigned by me', count: lists['by-me'].length },
                  { value: 'reviewing', label: 'Reviewing', count: lists.reviewing.length },
                ]}
              />
            }
          >
            {groups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-6 text-center sm:flex-row sm:text-left">
                <EmptyIllustration className="h-16 w-auto shrink-0" />
                <div>
                  <p className="text-[12.5px] font-semibold text-ink">
                    {scope === 'by-me'
                      ? 'You haven’t assigned anything yet'
                      : scope === 'reviewing'
                        ? 'Nothing waiting on your review'
                        : 'You’re all caught up'}
                  </p>
                  <p className="text-[12px] text-muted">
                    Assignments you make from a task or the Assignments page show up here with who
                    and when.
                  </p>
                </div>
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.id} aria-label={g.title}>
                  <h3
                    className={`flex items-center gap-2 border-b border-line bg-sunken/40 px-3.5 py-1.5 text-[11.5px] font-semibold ${g.tone}`}
                  >
                    {g.title}
                    <span className="font-medium tabular-nums text-muted">{g.items.length}</span>
                  </h3>
                  <ul className="divide-y divide-line">
                    {g.items.map((t) => (
                      <MyTaskRow
                        key={t.key}
                        task={t}
                        showOwner={scope !== 'mine'}
                        onStatus={(s) => updateTask(t.key, { status: s })}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-3.5 md:grid-cols-2 xl:grid-cols-1">
          <Panel
            title="Your activity"
            meta={<span>{label}</span>}
            action={
              <Link
                to={`/activity?member=${currentUserId}`}
                className="font-medium text-accent hover:underline"
              >
                All
              </Link>
            }
          >
            {myEvents.length === 0 ? (
              <p className="px-3.5 py-3 text-[12.5px] text-muted">
                No recorded actions in this range.
              </p>
            ) : (
              <ol className="divide-y divide-line">
                {myEvents.slice(0, 6).map((e) => (
                  <li
                    key={e.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3.5 py-1.5"
                  >
                    <p className="min-w-0 truncate text-[12px] text-ink">
                      <Link
                        to={`/tasks/${e.taskKey}`}
                        className="font-mono font-semibold hover:underline"
                      >
                        {e.taskKey}
                      </Link>{' '}
                      <span className="text-muted">{describeEvent(e)}</span>
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

          <Panel title="Mentions" meta={<span>{mentions.length} new</span>}>
            <ul className="divide-y divide-line">
              {mentions.map((m) => (
                <li key={m.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 px-3.5 py-2">
                  <Avatar id={m.author} size="sm" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
                      <span className="font-semibold text-ink">{firstName(m.author)}</span>
                      <span>on</span>
                      <Link
                        to={
                          m.target.startsWith('INC')
                            ? `/incidents/${m.target}`
                            : `/tasks/${m.target}`
                        }
                        className="font-mono font-medium text-accent hover:underline"
                      >
                        {m.target}
                      </Link>
                      <span className="ml-auto tabular-nums">{m.ago}</span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink">{m.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Modal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        title="Notification settings"
        description="Event-driven and quiet by default. Mentions are always delivered."
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setPrefsOpen(false);
              toast.success('Notification settings saved');
            }}
          >
            Done
          </Button>
        }
      >
        <ul className="-mx-4 -my-3.5 divide-y divide-line">
          {prefs.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink">{p.label}</p>
                <p className="text-[11.5px] text-muted">{p.desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={settings[p.id]}
                aria-label={p.label}
                onClick={() => setSettings((s) => ({ ...s, [p.id]: !s[p.id] }))}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${settings[p.id] ? 'bg-accent' : 'bg-line-strong'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${settings[p.id] ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                />
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function MyTaskRow({
  task,
  showOwner,
  onStatus,
}: {
  task: Task;
  showOwner: boolean;
  onStatus: (s: TaskStatus) => void;
}) {
  const { events } = useWork();
  const project = projects.find((p) => p.id === task.projectId);
  const assigned = [...events]
    .reverse()
    .find((e) => e.taskKey === task.key && e.kind === 'assignee');
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-2 md:grid-cols-[minmax(0,1fr)_118px_150px_64px_58px]">
      <div className="flex min-w-0 items-center gap-2">
        <ProductMark product={task.product} size="sm" />
        <div className="min-w-0">
          <Link
            to={`/tasks/${task.key}`}
            className="block truncate text-[12.5px] font-semibold text-ink hover:underline"
          >
            <span className="mr-1.5 font-mono text-[11.5px] font-medium text-muted">
              {task.key}
            </span>
            {task.title}
          </Link>
          <p className="truncate text-[11.5px] text-muted">{project?.name}</p>
        </div>
      </div>
      <select
        aria-label={`Status of ${task.key}`}
        value={task.status}
        onChange={(e) => {
          onStatus(e.target.value as TaskStatus);
          toast.success(`${task.key} → ${taskStatusMeta[e.target.value as TaskStatus].label}`);
        }}
        className="h-7 w-full rounded-md border border-line bg-white px-1.5 text-[12px] font-medium text-ink"
      >
        {(Object.keys(taskStatusMeta) as TaskStatus[]).map((s) => (
          <option key={s} value={s}>
            {taskStatusMeta[s].label}
          </option>
        ))}
      </select>
      <span
        className="col-span-2 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted md:col-span-1"
        title={assigned ? formatDateTime(new Date(assigned.at)) : undefined}
      >
        {showOwner ? (
          <>
            <Avatar id={task.assignee} size="xs" />
            <span className="truncate">
              <span className="font-medium text-ink">{firstName(task.assignee)}</span> owns it
            </span>
          </>
        ) : assigned ? (
          <>
            <Avatar id={assigned.actor} size="xs" />
            <span className="truncate">
              by <span className="font-medium text-ink">{firstName(assigned.actor)}</span> ·{' '}
              {relative(new Date(assigned.at))}
            </span>
          </>
        ) : (
          '—'
        )}
      </span>
      <span className="hidden md:block">
        <StatusBadge {...priorityMeta[task.priority]} />
      </span>
      <span
        className={`hidden text-right text-[12px] tabular-nums md:block ${task.overdue ? 'font-semibold text-bad' : 'text-ink'}`}
      >
        {task.due}
      </span>
    </li>
  );
}
