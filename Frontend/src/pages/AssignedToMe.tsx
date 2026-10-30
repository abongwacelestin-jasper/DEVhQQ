import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCheckIcon,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
  PlayIcon,
  SettingsIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '../components/ui/Avatar';
import { EmailSettingsModal } from '../components/assignments/EmailSettingsModal';
import { useWork } from '../contexts/WorkContext';
import { useAssignmentEmails, type AssignmentEmail } from '../hooks/useAssignmentEmails';
import { currentUserId } from '../data/team';
import { memberById, priorityMeta, taskStatusMeta } from '../utils/status';
import { formatDateTime, relative } from '../utils/date';

type View = 'all' | 'unread' | 'open' | 'overdue';
const views: { id: View; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'open', label: 'Still mine' },
  { id: 'overdue', label: 'Overdue' },
];

const subject = (e: AssignmentEmail, title: string) =>
  e.kind === 'test'
    ? `[Test] ${e.taskKey} · ${title}`
    : e.kind === 'assigned'
      ? `${e.taskKey} was assigned to you · ${title}`
      : `${e.taskKey} was reassigned · ${title}`;

/** Every assignment made to the signed-in member, as an inbox with simulated email delivery. */
export function AssignedToMe() {
  const { tasks, updateTask } = useWork();
  const {
    emails,
    prefs,
    setPrefs,
    read,
    markRead,
    markUnread,
    markAllRead,
    sendTest,
    myEmail,
    willEmail,
  } = useAssignmentEmails();
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState(false);
  const view = (params.get('view') as View) || 'all';
  const selectedId = params.get('id');

  const taskOf = (key: string) => tasks.find((t) => t.key === key);
  const list = useMemo(
    () =>
      emails.filter((e) => {
        const t = taskOf(e.taskKey);
        if (view === 'unread') return !read.includes(e.id);
        if (view === 'open')
          return e.kind === 'assigned' && t?.assignee === currentUserId && t?.status !== 'done';
        if (view === 'overdue') return !!t?.overdue && e.kind === 'assigned';
        return true;
      }),
    [emails, view, read, tasks], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const selected = list.find((e) => e.id === selectedId) ?? null;
  const unread = emails.filter((e) => !read.includes(e.id)).length;
  const openCount = tasks.filter((t) => t.assignee === currentUserId && t.status !== 'done').length;

  useEffect(() => {
    if (selected && !read.includes(selected.id)) markRead(selected.id);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'view') next.delete('id');
    setParams(next, { replace: k === 'id' });
  };

  const t = selected ? taskOf(selected.taskKey) : undefined;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Assigned to me</h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {unread} unread · {openCount} still open · email{' '}
            {prefs.mode === 'off' ? 'off' : prefs.mode === 'daily' ? 'daily digest' : 'instant'} to{' '}
            {myEmail}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={markAllRead}
            disabled={!unread}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12.5px] font-medium text-ink hover:bg-sunken/60 disabled:opacity-40"
          >
            <CheckCheckIcon className="h-3.5 w-3.5" /> Mark all read
          </button>
          <button
            onClick={() => setSettings(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-2.5 text-[12.5px] font-semibold text-white hover:bg-ink/90"
          >
            <SettingsIcon className="h-3.5 w-3.5" /> Email settings
          </button>
        </div>
      </header>

      <div className="grid overflow-hidden rounded-lg border border-line bg-white md:h-[calc(100vh-210px)] md:min-h-[520px] md:grid-cols-[minmax(280px,2fr)_minmax(0,3fr)]">
        <section
          aria-label="Assignments"
          className={`flex min-h-0 flex-col border-line md:border-r ${selected ? 'hidden md:flex' : 'flex'}`}
        >
          <div role="tablist" className="flex gap-1 border-b border-line px-2 py-2">
            {views.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => set('view', v.id === 'all' ? null : v.id)}
                className={`h-7 rounded-full px-2.5 text-[12px] font-medium transition-colors duration-150 ${view === v.id ? 'bg-ink text-white' : 'text-ink hover:bg-sunken'}`}
              >
                {v.label}
                {v.id === 'unread' && unread ? ` ${unread}` : ''}
              </button>
            ))}
          </div>
          {list.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <InboxIcon className="h-6 w-6 text-muted" />
              <p className="text-[13px] font-medium text-ink">Nothing here</p>
              <p className="text-[12px] text-muted">
                New assignments appear here and in your email.
              </p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto scroll-thin">
              {list.map((e) => {
                const task = taskOf(e.taskKey);
                const isUnread = !read.includes(e.id);
                const active = e.id === selected?.id;
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => set('id', e.id)}
                      className={`grid w-full grid-cols-[8px_28px_minmax(0,1fr)] items-start gap-2 px-3 py-2.5 text-left transition-colors duration-150 ${active ? 'bg-sunken' : 'hover:bg-sunken/50'}`}
                    >
                      <span
                        className={`mt-2.5 h-2 w-2 rounded-full ${isUnread ? 'bg-accent' : 'bg-transparent'}`}
                        aria-label={isUnread ? 'Unread' : undefined}
                      />
                      <Avatar id={e.actor} size="sm" />
                      <span className="min-w-0">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-[12.5px] ${isUnread ? 'font-semibold' : 'font-medium'} text-ink`}
                          >
                            {e.kind === 'test' ? 'DevHQ' : memberById(e.actor).name}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-muted">
                            {relative(new Date(e.at)).replace(' ago', '')}
                          </span>
                        </span>
                        <span
                          className={`block truncate text-[12.5px] ${isUnread ? 'text-ink' : 'text-muted'}`}
                        >
                          {subject(e, task?.title ?? '')}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                          {willEmail(e) ? <MailIcon className="h-3 w-3" /> : null}
                          {task ? taskStatusMeta[task.status].label : ''}
                          {task?.overdue && e.kind === 'assigned' ? (
                            <span className="font-semibold text-bad">· Overdue</span>
                          ) : null}
                          {e.kind === 'unassigned' ? <span>· Handed over</span> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          aria-label="Email"
          className={`min-h-0 flex-col overflow-y-auto scroll-thin ${selected ? 'flex' : 'hidden md:flex'}`}
        >
          {!selected || !t ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <MailOpenIcon className="h-6 w-6 text-muted" />
              <p className="text-[13px] font-medium text-ink">Select an assignment</p>
              <p className="max-w-xs text-[12px] text-muted">
                You’ll see the email exactly as it was delivered, with actions to start the work.
              </p>
            </div>
          ) : (
            <article className="flex flex-1 flex-col">
              <header className="border-b border-line px-4 py-3">
                <button
                  onClick={() => set('id', null)}
                  className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-ink md:hidden"
                >
                  <ArrowLeftIcon className="h-3.5 w-3.5" /> All assignments
                </button>
                <h2 className="text-[15px] font-semibold text-ink">{subject(selected, t.title)}</h2>
                <dl className="mt-1.5 grid grid-cols-[48px_minmax(0,1fr)] gap-y-0.5 text-[12px]">
                  <dt className="text-muted">From</dt>
                  <dd className="truncate text-ink">
                    DevHQ &lt;notify@devhq.app&gt; on behalf of {memberById(selected.actor).name}
                  </dd>
                  <dt className="text-muted">To</dt>
                  <dd className="truncate text-ink">{myEmail}</dd>
                  <dt className="text-muted">Sent</dt>
                  <dd className="text-ink">
                    {formatDateTime(new Date(selected.at))} ·{' '}
                    {willEmail(selected)
                      ? prefs.mode === 'daily'
                        ? 'in daily digest'
                        : 'delivered'
                      : 'in-app only'}
                  </dd>
                </dl>
              </header>
              <div className="flex-1 space-y-4 px-4 py-4">
                <p className="text-[13px] leading-relaxed text-ink">
                  {selected.kind === 'unassigned'
                    ? `${memberById(selected.actor).name} moved this task to ${memberById(t.assignee).name}. You don’t need to do anything — your logged time stays on the task.`
                    : `${memberById(selected.actor).name} assigned you a ${priorityMeta[t.priority].label.toLowerCase()} priority ${t.type}. It’s due ${t.due}.`}
                </p>
                {selected.note && (
                  <blockquote className="border-l-2 border-line-strong pl-3 text-[12.5px] italic text-muted">
                    “{selected.note}”
                  </blockquote>
                )}
                <div className="rounded-lg border border-line">
                  <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                    <span className="font-mono text-[12px] font-semibold text-accent">{t.key}</span>
                    <span className="text-[11.5px] text-muted">
                      {taskStatusMeta[t.status].label}
                    </span>
                  </div>
                  <p className="px-3 pt-2 text-[13px] font-semibold text-ink">{t.title}</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2.5 text-[12px] sm:grid-cols-4">
                    <div>
                      <dt className="text-muted">Priority</dt>
                      <dd className="font-medium text-ink">{priorityMeta[t.priority].label}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Due</dt>
                      <dd className={`font-medium ${t.overdue ? 'text-bad' : 'text-ink'}`}>
                        {t.due}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Estimate</dt>
                      <dd className="font-medium text-ink">{t.estimate} pts</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Assignee</dt>
                      <dd className="truncate font-medium text-ink">
                        {memberById(t.assignee).name}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/tasks/${t.key}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-white hover:bg-ink/90"
                  >
                    Open task <ArrowRightIcon className="h-3.5 w-3.5" />
                  </Link>
                  {selected.kind !== 'unassigned' && t.status === 'backlog' && (
                    <button
                      onClick={() => {
                        updateTask(t.key, { status: 'in-progress' }, 'Started from Assigned to me');
                        toast.success(`${t.key} moved to In progress`);
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[12.5px] font-medium text-ink hover:bg-sunken/60"
                    >
                      <PlayIcon className="h-3.5 w-3.5" /> Start work
                    </button>
                  )}
                  <button
                    onClick={() => {
                      markUnread(selected.id);
                      set('id', null);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-muted hover:bg-sunken hover:text-ink"
                  >
                    <MailIcon className="h-3.5 w-3.5" /> Mark unread
                  </button>
                </div>
                <p className="border-t border-line pt-3 text-[11px] text-muted">
                  You get this because email for assignments is{' '}
                  {prefs.mode === 'off' ? 'off' : 'on'}.{' '}
                  <button
                    onClick={() => setSettings(true)}
                    className="font-medium text-accent hover:underline"
                  >
                    Change preferences
                  </button>
                </p>
              </div>
            </article>
          )}
        </section>
      </div>

      <EmailSettingsModal
        open={settings}
        onClose={() => setSettings(false)}
        prefs={prefs}
        email={myEmail}
        onSave={setPrefs}
        onTest={sendTest}
      />
    </div>
  );
}
