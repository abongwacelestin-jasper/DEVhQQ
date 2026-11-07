import { useLanguage } from '../contexts/LanguageContext';
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AtSignIcon,
  BellIcon,
  CheckCheckIcon,
  CheckIcon,
  InboxIcon,
  PlusIcon,
  RocketIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Segmented';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ChecklistIllustration } from '../components/illustrations/ChecklistIllustration';
import { EmptyIllustration } from '../components/illustrations/EmptyIllustration';
import { useReauth } from '../contexts/ReauthContext';
import { useWork } from '../contexts/WorkContext';
import { useDateRange } from '../contexts/DateRangeContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useAuth } from '../contexts/AuthContext';
import { priorityMeta, taskStatusMeta } from '../utils/status';
import { useDeployments } from '../hooks/useDeployments';
import { useDirectory } from '../components/team/useDirectory';
import { useNotifications, type ApiNotification } from '../components/work/useNotifications';
import { DemoBadge, Unavailable } from '../components/work/Unavailable';
import { NOW, addDays, formatDateTime, parseWhen, relative, startOfDay } from '../utils/date';
import { describeEvent, formatMinutes } from '../utils/taskEvents';
import type { Task, TaskStatus } from '../types/work';
import type { Deployment } from '../types/operations';

type Scope = 'mine' | 'by-me' | 'reviewing';

export function MyWork() {
  const { heading } = useLanguage();
  const { requestReauth } = useReauth();
  const { tasks, events, timeLogs, updateTask } = useWork();
  const { inRange, label } = useDateRange();
  const { matchesTask } = useProductFilter();
  const { openCreateTask } = useWorkspaceUI();
  const { canDo, session } = useAuth();
  const me = session?.memberId ?? '';
  const canApprove = canDo('deploy:approve');
  const { deployments, approve, loading: deploysLoading } = useDeployments();
  const inbox = useNotifications();
  const [scope, setScope] = useState<Scope>('mine');

  // Two-person rule: the server refuses self-approval, so a requester never sees their own request here.
  const pending = useMemo(
    () =>
      canApprove
        ? deployments.filter((d) => d.status === 'awaiting-approval' && d.author !== me)
        : [],
    [canApprove, deployments, me],
  );
  const mentions = useMemo(() => inbox.items.filter((n) => n.kind === 'mention'), [inbox.items]);

  const assignedByMe = useMemo(() => {
    const keys = new Set<string>();
    events
      .filter((e) => e.kind === 'assignee' && e.actor === me && e.to !== me)
      .forEach((e) => keys.add(e.taskKey));
    return tasks.filter((t) => keys.has(t.key) && t.assignee !== me);
  }, [events, tasks, me]);

  const lists: Record<Scope, Task[]> = {
    mine: tasks.filter((t) => t.assignee === me),
    'by-me': assignedByMe,
    reviewing: tasks.filter((t) => t.reviewer === me),
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
    .filter((e) => e.actor === me && inRange(new Date(e.at)))
    .sort((a, b) => b.at.localeCompare(a.at));
  const loggedMin = timeLogs
    .filter((l) => l.member === me && inRange(new Date(l.at)))
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

  return (
    <div className="space-y-3.5">
      <section className="grid items-center gap-3 overflow-hidden rounded-lg border border-line bg-accent-soft/40 px-3.5 py-3 md:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <ChecklistIllustration className="hidden h-[84px] w-auto md:block" />
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">
            {heading('My work')}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Approvals, tasks and mentions that need you. Open work always shows; completed work and
            activity follow the date range.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="primary"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => openCreateTask({ assignee: me })}
            >
              New task for me
            </Button>
            <Link
              to="/inbox"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-white px-2.5 text-[12px] font-medium text-ink hover:bg-sunken/60"
            >
              <BellIcon className="h-3.5 w-3.5" /> Assigned to me
            </Link>
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
              {deploysLoading && pending.length === 0 ? (
                <p className="px-3.5 py-3 text-[12.5px] text-muted">Loading deployments…</p>
              ) : pending.length === 0 ? (
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ok-soft text-ok">
                    <CheckIcon className="h-4 w-4" />
                  </span>
                  <p className="text-[12.5px] text-ink">
                    No deployments are waiting on you. Requests from others appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {pending.map((d) => (
                      <ApprovalRow
                        key={d.id}
                        deployment={d}
                        onApprove={() =>
                          requestReauth({
                            title: `Approve ${d.env} deploy`,
                            description: `${d.sha} will be handed to ${d.provider}.`,
                            actionLabel: 'Verify & approve',
                            onConfirm: () => void approve(d.id),
                          })
                        }
                      />
                    ))}
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
                to={`/activity?member=${me}`}
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

          <InboxPanel inbox={inbox} />

          <Panel
            title="Mentions"
            meta={
              inbox.status === 'ready' ? (
                <span>{mentions.filter((m) => !m.read).length} new</span>
              ) : undefined
            }
          >
            {inbox.status === 'unavailable' ? (
              <Unavailable
                compact
                title="Mentions aren't available"
                detail="The collaboration service isn't deployed on this server."
              />
            ) : inbox.status === 'ready' && mentions.length === 0 ? (
              <p className="px-3.5 py-3 text-[12.5px] text-muted">No one has mentioned you yet.</p>
            ) : (
              <NotificationList
                items={mentions.slice(0, 8)}
                onOpen={(n) => void inbox.markRead([n.id])}
                icon={AtSignIcon}
              />
            )}
          </Panel>
        </div>
      </div>
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
  const { memberById } = useDirectory();
  const { allowedProjects: projects } = useProductFilter();
  const firstName = (id: string) => memberById(id).name.split(' ')[0];
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

function ApprovalRow({
  deployment: d,
  onApprove,
}: {
  deployment: Deployment;
  onApprove: () => void;
}) {
  const { memberById } = useDirectory();
  return (
    <motion.li
      layout
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 overflow-hidden px-3.5 py-2 md:grid-cols-[28px_minmax(0,1fr)_150px_48px_auto]"
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-md ${d.env === 'production' ? 'bg-bad-soft text-bad' : 'bg-sunken text-ink'}`}
      >
        <RocketIcon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <ProductMark product={d.product} size="sm" />
          <span className="truncate">
            Deploy {d.message} to {d.env}
          </span>
        </p>
        <p className="truncate text-[11.5px] text-muted">
          <span className="font-mono">{d.sha}</span> · {d.provider}
        </p>
      </div>
      <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-[12px] text-ink md:col-start-auto">
        <Avatar id={d.author} size="xs" />
        <span className="truncate">{memberById(d.author).name}</span>
      </span>
      <span className="hidden text-right text-[11.5px] tabular-nums text-muted md:block">
        {d.ago}
      </span>
      <div className="col-start-2 flex gap-1.5 md:col-start-auto">
        <Link
          to={`/deployments/${d.id}`}
          className="inline-flex h-7 items-center rounded-md border border-line-strong px-2.5 text-[12px] font-medium text-ink hover:bg-sunken/60"
        >
          Details
        </Link>
        <Button
          size="sm"
          variant={d.env === 'production' ? 'danger' : 'primary'}
          icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}
          onClick={onApprove}
        >
          Approve
        </Button>
      </div>
    </motion.li>
  );
}

function InboxPanel({ inbox }: { inbox: ReturnType<typeof useNotifications> }) {
  const unreadItems = inbox.items.filter((n) => !n.read);
  return (
    <Panel
      title="Inbox"
      meta={
        inbox.status === 'ready' ? (
          <span className="flex items-center gap-1.5">
            {inbox.demo && <DemoBadge />}
            <span className="tabular-nums">{inbox.unread} unread</span>
          </span>
        ) : undefined
      }
      action={
        inbox.status === 'ready' && inbox.unread > 0 ? (
          <button
            onClick={() => void inbox.markRead('all')}
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
          >
            <CheckCheckIcon className="h-3 w-3" aria-hidden /> Mark all read
          </button>
        ) : undefined
      }
    >
      {inbox.status === 'loading' ? (
        <p className="px-3.5 py-3 text-[12.5px] text-muted">Loading notifications…</p>
      ) : inbox.status === 'unavailable' ? (
        <Unavailable
          compact
          title="Notifications aren't available"
          detail="The collaboration service isn't deployed on this server."
          onRetry={() => void inbox.reload()}
        />
      ) : inbox.status === 'error' ? (
        <Unavailable
          compact
          title="Couldn't load notifications"
          detail={inbox.error ?? undefined}
          onRetry={() => void inbox.reload()}
        />
      ) : inbox.items.length === 0 ? (
        <div className="flex items-center gap-2 px-3.5 py-3 text-[12.5px] text-muted">
          <InboxIcon className="h-4 w-4" aria-hidden /> You're all caught up.
        </div>
      ) : (
        <>
          <NotificationList
            items={(unreadItems.length ? unreadItems : inbox.items).slice(0, 8)}
            onOpen={(n) => void inbox.markRead([n.id])}
            icon={BellIcon}
          />
          {inbox.hasMore && (
            <button
              onClick={() => void inbox.loadMore()}
              className="w-full border-t border-line py-1.5 text-[11.5px] font-medium text-muted hover:text-ink"
            >
              Load older
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

/** Notification links are in-app paths only; anything else renders as plain text. */
const inAppPath = (link?: string) => (link && /^\/(?!\/)/.test(link) ? link : undefined);

function NotificationList({
  items,
  onOpen,
  icon: Icon,
}: {
  items: ApiNotification[];
  onOpen: (n: ApiNotification) => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const { members, memberById } = useDirectory();
  // The server stores mentions as `@memberId`; show the member's name instead.
  const known = new Set(members.map((m) => m.id));
  const names = (text: string) =>
    text.replace(/@([A-Za-z0-9][\w-]{0,39})/g, (whole, id: string) =>
      known.has(id) ? `@${memberById(id).name}` : whole,
    );
  return (
    <ul className="divide-y divide-line" aria-live="polite">
      {items.map((n) => {
        const to = inAppPath(n.link);
        const body = (
          <>
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
              {!n.read && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unread" />
              )}
              {n.actor && (
                <span className="font-semibold text-ink">
                  {memberById(n.actor).name.split(' ')[0]}
                </span>
              )}
              <span className="ml-auto tabular-nums" title={formatDateTime(new Date(n.at))}>
                {relative(new Date(n.at))}
              </span>
            </p>
            <p className={`mt-0.5 text-[12.5px] ${n.read ? 'text-muted' : 'text-ink'}`}>
              {names(n.title)}
            </p>
            {n.body && (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{names(n.body)}</p>
            )}
          </>
        );
        return (
          <li key={n.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 px-3.5 py-2">
            {n.actor ? (
              <Avatar id={n.actor} size="sm" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sunken text-muted">
                <Icon className="h-3 w-3" />
              </span>
            )}
            {to ? (
              <Link to={to} onClick={() => onOpen(n)} className="min-w-0 hover:opacity-80">
                {body}
              </Link>
            ) : (
              <button type="button" onClick={() => onOpen(n)} className="min-w-0 text-left">
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
