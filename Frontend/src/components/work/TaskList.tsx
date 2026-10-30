import { Link } from 'react-router-dom';
import { LockIcon } from 'lucide-react';
import type { Task } from '../../types/work';
import { Avatar } from '../ui/Avatar';
import { ProductMark } from '../ui/ProductMark';
import { StatusBadge } from '../ui/StatusBadge';
import { priorityMeta, taskStatusMeta, firstName } from '../../utils/status';
import { useWork } from '../../contexts/WorkContext';
import { relative } from '../../utils/date';
import { describeEvent } from '../../utils/taskEvents';

export function TaskList({
  tasks,
  emptyLabel = 'No tasks match these filters.',
}: {
  tasks: Task[];
  emptyLabel?: string;
}) {
  const { events } = useWork();
  const latest = (key: string) =>
    events.filter((e) => e.taskKey === key).sort((a, b) => b.at.localeCompare(a.at))[0];

  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-line px-4 py-8 text-center text-[12.5px] text-muted">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[820px] text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-sunken/40 text-left text-[11.5px] text-muted">
              <th className="px-3.5 py-2 font-medium">Task</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Last change</th>
              <th className="px-3.5 py-2 text-right font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const ev = latest(t.key);
              return (
                <tr
                  key={t.key}
                  className="border-b border-line transition-colors duration-150 last:border-0 hover:bg-sunken/50"
                >
                  <td className="max-w-[320px] px-3.5 py-2">
                    <Link to={`/tasks/${t.key}`} className="flex min-w-0 items-center gap-2">
                      <ProductMark product={t.product} size="sm" />
                      <span className="w-12 shrink-0 font-mono text-[11.5px] text-muted">
                        {t.key}
                      </span>
                      <span className="truncate font-medium text-ink hover:underline">
                        {t.title}
                      </span>
                      {t.blockedBy && (
                        <LockIcon
                          className="h-3.5 w-3.5 shrink-0 text-warn"
                          aria-label={`Blocked by ${t.blockedBy}`}
                        />
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge {...taskStatusMeta[t.status]} dot />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge {...priorityMeta[t.priority]} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/team/${t.assignee}`}
                      className="flex items-center gap-1.5 text-ink hover:underline"
                    >
                      <Avatar id={t.assignee} size="xs" />
                      {firstName(t.assignee)}
                    </Link>
                  </td>
                  <td className="max-w-[230px] px-3 py-2">
                    {ev ? (
                      <p
                        className="truncate text-[12px] text-muted"
                        title={`${firstName(ev.actor)} ${describeEvent(ev)}`}
                      >
                        <span className="font-medium text-ink">{firstName(ev.actor)}</span>{' '}
                        {describeEvent(ev)} · {relative(new Date(ev.at))}
                      </p>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3.5 py-2 text-right text-[12px] ${t.overdue ? 'font-semibold text-bad' : 'text-muted'}`}
                  >
                    {t.due}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
