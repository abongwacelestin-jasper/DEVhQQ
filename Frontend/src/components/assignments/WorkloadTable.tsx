import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDownIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { ProductMark } from '../ui/ProductMark';
import { StatusBadge } from '../ui/StatusBadge';
import { priorityMeta, taskStatusMeta } from '../../utils/status';
import { formatMinutes } from '../../utils/taskEvents';
import { useTaskInsights } from '../work/useTaskInsights';
import { TaskInsightBadge } from '../work/TaskInsightBadge';
import type { Member } from '../../types/team';
import type { Task } from '../../types/work';

export interface WorkloadRow {
  m: Member;
  open: Task[];
  load: number;
  backlog: number;
  progress: number;
  review: number;
  overdue: number;
  doneInRange: number;
  logged: number;
}

export function WorkloadTable({
  rows,
  onReassign,
  canAssign,
}: {
  rows: WorkloadRow[];
  onReassign: (t: Task) => void;
  canAssign: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[760px] text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-sunken/40 text-left text-[11.5px] text-muted">
            <th className="px-3.5 py-2 font-medium">Person</th>
            <th className="w-[180px] px-3 py-2 font-medium">Load (pts / capacity)</th>
            <th className="px-2 py-2 text-center font-medium">Backlog</th>
            <th className="px-2 py-2 text-center font-medium">Doing</th>
            <th className="px-2 py-2 text-center font-medium">Review</th>
            <th className="px-2 py-2 text-center font-medium">Overdue</th>
            <th className="px-2 py-2 text-center font-medium">Done</th>
            <th className="px-2 py-2 text-right font-medium">Logged</th>
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-3.5 py-8 text-center text-muted">
                No one matches these filters.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const pct = Math.min(100, (r.load / r.m.capacity) * 100);
            const over = r.load > r.m.capacity;
            const isOpen = expanded === r.m.id;
            return (
              <Fragment key={r.m.id}>
                <tr className="border-b border-line hover:bg-sunken/40">
                  <td className="px-3.5 py-1.5">
                    <Link to={`/team/${r.m.id}`} className="flex min-w-0 items-center gap-2">
                      <Avatar id={r.m.id} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink hover:underline">
                          {r.m.name}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted">{r.m.role}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                        <span
                          className={`block h-full rounded-full ${over ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-ok'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span
                        className={`w-11 text-right tabular-nums ${over ? 'font-semibold text-bad' : 'text-ink'}`}
                      >
                        {r.load}/{r.m.capacity}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-ink">{r.backlog}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-ink">{r.progress}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-ink">{r.review}</td>
                  <td
                    className={`px-2 py-1.5 text-center tabular-nums ${r.overdue ? 'font-semibold text-bad' : 'text-muted'}`}
                  >
                    {r.overdue}
                  </td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-ok">{r.doneInRange}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                    {formatMinutes(r.logged)}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => setExpanded(isOpen ? null : r.m.id)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} ${r.m.name}'s tasks`}
                      className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
                    >
                      <ChevronDownIcon
                        className={`h-4 w-4 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line bg-sunken/30">
                    <td colSpan={9} className="px-3.5 py-2">
                      {r.open.length === 0 ? (
                        <p className="py-1 text-[12px] text-muted">No open tasks.</p>
                      ) : (
                        <OpenTaskList
                          tasks={r.open}
                          canAssign={canAssign}
                          onReassign={onReassign}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OpenTaskList({
  tasks,
  canAssign,
  onReassign,
}: {
  tasks: Task[];
  canAssign: boolean;
  onReassign: (t: Task) => void;
}) {
  const insights = useTaskInsights(tasks.map((t) => t.key));
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
      {tasks.map((t) => (
        <li
          key={t.key}
          className="grid grid-cols-[minmax(0,1fr)_96px_70px_40px_56px_auto] items-center gap-3 px-3 py-1.5"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Link
              to={`/tasks/${t.key}`}
              className="flex min-w-0 items-center gap-2 hover:underline"
            >
              <ProductMark product={t.product} size="sm" />
              <span className="font-mono text-[11.5px] text-muted">{t.key}</span>
              <span className="truncate font-medium text-ink">{t.title}</span>
            </Link>
            {insights.available && <TaskInsightBadge insight={insights.get(t.key)} />}
          </span>
          <StatusBadge {...taskStatusMeta[t.status]} dot />
          <StatusBadge {...priorityMeta[t.priority]} />
          <span className="text-right text-[11.5px] tabular-nums text-muted">{t.estimate}p</span>
          <span
            className={`text-right text-[12px] tabular-nums ${t.overdue ? 'font-semibold text-bad' : 'text-ink'}`}
          >
            {t.due}
          </span>
          {canAssign ? (
            <Button size="sm" onClick={() => onReassign(t)}>
              Reassign
            </Button>
          ) : (
            <span />
          )}
        </li>
      ))}
    </ul>
  );
}
