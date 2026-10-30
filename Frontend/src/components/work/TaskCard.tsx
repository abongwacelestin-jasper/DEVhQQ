import React from 'react';
import {
  BugIcon,
  CircleDotIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  LockIcon,
  MessageSquareIcon,
  PaletteIcon,
  SparkleIcon,
} from 'lucide-react';
import type { Task, TaskType } from '../../types/work';
import { Avatar } from '../ui/Avatar';
import { pullRequests } from '../../data/engineering';
import { toneDot, ciMeta } from '../../utils/status';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useWork } from '../../contexts/WorkContext';

export const typeIcon: Record<TaskType, React.ComponentType<{ className?: string }>> = {
  feature: SparkleIcon,
  bug: BugIcon,
  task: CircleDotIcon,
  design: PaletteIcon,
};

const priorityBar: Record<Task['priority'], string> = {
  urgent: 'bg-bad',
  high: 'bg-warn',
  medium: 'bg-line-strong',
  low: 'bg-line',
};

export function TaskCard({ task }: { task: Task }) {
  const { openTask } = useWorkspaceUI();
  const { subtasks } = useWork();
  const Icon = typeIcon[task.type];
  const pr = task.pr ? pullRequests.find((p) => p.number === task.pr) : undefined;
  const subs = subtasks.filter((s) => s.taskKey === task.key);
  const subsDone = subs.filter((s) => s.done).length;

  return (
    <button
      onClick={() => openTask(task.key)}
      className="group relative w-full overflow-hidden rounded-md border border-line bg-white px-2.5 py-2 text-left transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-sm"
    >
      <span
        className={`absolute inset-y-2 left-0 w-[3px] rounded-r ${priorityBar[task.priority]}`}
        aria-label={`${task.priority} priority`}
      />
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-ink">{task.title}</p>
        <Avatar id={task.assignee} size="xs" />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <Icon className={`h-3 w-3 ${task.type === 'bug' ? 'text-bad' : ''}`} />
          <span className="font-mono">{task.key}</span>
        </span>
        {task.blockedBy && (
          <span
            className="flex items-center gap-0.5 font-medium text-warn"
            title={`Blocked by ${task.blockedBy}`}
          >
            <LockIcon className="h-3 w-3" />
          </span>
        )}
        {pr && (
          <span className="flex items-center gap-0.5 font-mono" title={ciMeta[pr.ci].label}>
            <GitPullRequestIcon className="h-3 w-3" />
            {pr.number}
            <span className={`h-1.5 w-1.5 rounded-full ${toneDot[ciMeta[pr.ci].tone]}`} />
          </span>
        )}
        {subs.length > 0 && (
          <span
            className={`flex items-center gap-0.5 tabular-nums ${subsDone === subs.length ? 'text-ok' : ''}`}
            title="Subtasks done"
          >
            <ListChecksIcon className="h-3 w-3" />
            {subsDone}/{subs.length}
          </span>
        )}
        {task.comments > 0 && (
          <span className="flex items-center gap-0.5">
            <MessageSquareIcon className="h-3 w-3" />
            {task.comments}
          </span>
        )}
        <span className={`ml-auto shrink-0 ${task.overdue ? 'font-semibold text-bad' : ''}`}>
          {task.due}
        </span>
      </div>
    </button>
  );
}
