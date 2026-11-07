import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightLeftIcon,
  CalendarIcon,
  CheckSquareIcon,
  CircleDotIcon,
  ClockIcon,
  FlagIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  PlusCircleIcon,
  SendIcon,
  UserRoundIcon,
} from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { useWork } from '../../contexts/WorkContext';
import { useAuth } from '../../contexts/AuthContext';
import { firstName } from '../../utils/status';
import { formatDateTime, relative } from '../../utils/date';
import { describeEvent, formatMinutes } from '../../utils/taskEvents';
import type { TaskEventKind } from '../../types/work';

type Tab = 'all' | 'comments' | 'history' | 'time';

const kindIcon: Record<TaskEventKind, React.ComponentType<{ className?: string }>> = {
  created: PlusCircleIcon,
  status: CircleDotIcon,
  assignee: UserRoundIcon,
  reviewer: UserRoundIcon,
  priority: FlagIcon,
  due: CalendarIcon,
  estimate: ArrowRightLeftIcon,
  comment: MessageSquareIcon,
  subtask: CheckSquareIcon,
  time: ClockIcon,
  linked: GitPullRequestIcon,
};

interface Row {
  id: string;
  at: string;
  actor: string;
  kind: 'event' | 'comment' | 'time';
  icon: React.ComponentType<{ className?: string }>;
  text: React.ReactNode;
  body?: string;
}

export function TaskTimeline({ taskKey }: { taskKey: string }) {
  const { events, comments, timeLogs, addComment } = useWork();
  const { session } = useAuth();
  const [tab, setTab] = useState<Tab>('all');
  const [draft, setDraft] = useState('');

  const rows = useMemo<Row[]>(() => {
    const ev: Row[] = events
      .filter((e) => e.taskKey === taskKey && e.kind !== 'comment' && e.kind !== 'time')
      .map((e) => ({
        id: e.id,
        at: e.at,
        actor: e.actor,
        kind: 'event',
        icon: kindIcon[e.kind],
        text: describeEvent(e),
        body: e.kind !== 'subtask' ? e.note : undefined,
      }));
    const cm: Row[] = comments
      .filter((c) => c.taskKey === taskKey)
      .map((c) => ({
        id: c.id,
        at: c.at,
        actor: c.author,
        kind: 'comment',
        icon: MessageSquareIcon,
        text: 'commented',
        body: c.text,
      }));
    const tl: Row[] = timeLogs
      .filter((l) => l.taskKey === taskKey)
      .map((l) => ({
        id: l.id,
        at: l.at,
        actor: l.member,
        kind: 'time',
        icon: ClockIcon,
        text: `logged ${formatMinutes(l.minutes)}`,
        body: l.note,
      }));
    return [...ev, ...cm, ...tl].sort((a, b) => b.at.localeCompare(a.at));
  }, [events, comments, timeLogs, taskKey]);

  const visible = rows.filter(
    (r) =>
      tab === 'all' ||
      (tab === 'comments' && r.kind === 'comment') ||
      (tab === 'history' && r.kind === 'event') ||
      (tab === 'time' && r.kind === 'time'),
  );
  const counts = {
    comments: rows.filter((r) => r.kind === 'comment').length,
    history: rows.filter((r) => r.kind === 'event').length,
    time: rows.filter((r) => r.kind === 'time').length,
  };

  const post = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    addComment(taskKey, draft.trim());
    setDraft('');
  };

  return (
    <Panel title="Activity" meta={<span>Who did what, and when</span>}>
      <div className="border-b border-line px-3.5 py-2">
        <Segmented<Tab>
          label="Activity filter"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All', count: rows.length },
            { value: 'comments', label: 'Comments', count: counts.comments },
            { value: 'history', label: 'History', count: counts.history },
            { value: 'time', label: 'Time', count: counts.time },
          ]}
        />
      </div>
      <ol className="divide-y divide-line">
        {visible.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2.5 px-3.5 py-2"
          >
            <span
              className={`mt-px flex h-[22px] w-[22px] items-center justify-center rounded-full ${r.kind === 'comment' ? 'bg-accent-soft text-accent' : r.kind === 'time' ? 'bg-ok-soft text-ok' : 'bg-sunken text-muted'}`}
            >
              <r.icon className="h-3 w-3" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-ink">
                <Link
                  to={`/team/${r.actor}`}
                  className="inline-flex items-center gap-1 align-middle font-semibold hover:underline"
                >
                  <Avatar id={r.actor} size="xs" />
                  {firstName(r.actor)}
                </Link>{' '}
                <span className="text-muted">{r.text}</span>
              </p>
              {r.body && (
                <p
                  className={`mt-1 text-[12.5px] ${r.kind === 'comment' ? 'rounded-md bg-sunken/70 px-2.5 py-1.5 text-ink' : 'text-muted'}`}
                >
                  {r.body}
                </p>
              )}
            </div>
            <time
              dateTime={r.at}
              title={formatDateTime(new Date(r.at))}
              className="whitespace-nowrap pt-0.5 text-[11.5px] tabular-nums text-muted"
            >
              <span className="hidden sm:inline">{formatDateTime(new Date(r.at))}</span>
              <span className="sm:hidden">{relative(new Date(r.at))}</span>
            </time>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-3.5 py-4 text-[12.5px] text-muted">Nothing here yet.</li>
        )}
      </ol>
      <form onSubmit={post} className="flex items-end gap-2 border-t border-line p-2.5">
        {session && <Avatar id={session.memberId} size="sm" />}
        <label className="min-w-0 flex-1">
          <span className="sr-only">Write a comment</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(e);
            }}
            rows={2}
            placeholder="Write a comment… (⌘↵ to send)"
            className="w-full resize-none rounded-md border border-line px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-subtle focus:border-accent"
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!draft.trim()}
          icon={<SendIcon className="h-3.5 w-3.5" />}
        >
          Send
        </Button>
      </form>
    </Panel>
  );
}
