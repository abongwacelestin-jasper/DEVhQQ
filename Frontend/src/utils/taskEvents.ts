import type { TaskEvent, TaskEventKind } from '../types/work';
import { firstName, priorityMeta, taskStatusMeta } from './status';
import type { Priority, TaskStatus } from '../types/work';

export function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const statusLabel = (s?: string) =>
  s && s in taskStatusMeta ? taskStatusMeta[s as TaskStatus].label : (s ?? '—');
const priorityLabel = (s?: string) =>
  s && s in priorityMeta ? priorityMeta[s as Priority].label : (s ?? '—');

/** Human sentence (without the actor) for a task event: "moved RB-212 from Backlog to In progress". */
export function describeEvent(e: TaskEvent): string {
  switch (e.kind) {
    case 'created':
      return 'created';
    case 'status':
      return `moved from ${statusLabel(e.from)} to ${statusLabel(e.to)}`;
    case 'assignee':
      if (!e.to) return 'unassigned';
      return e.from
        ? `reassigned from ${firstName(e.from)} to ${firstName(e.to)}`
        : `assigned to ${firstName(e.to)}`;
    case 'reviewer':
      return e.to ? `set reviewer to ${firstName(e.to)}` : 'removed the reviewer';
    case 'priority':
      return `changed priority ${priorityLabel(e.from)} → ${priorityLabel(e.to)}`;
    case 'due':
      return e.from ? `moved due date ${e.from} → ${e.to}` : `set due date to ${e.to}`;
    case 'estimate':
      return `changed estimate ${e.from ?? 0} → ${e.to} pts`;
    case 'comment':
      return 'commented';
    case 'subtask':
      return `${e.to === 'added' ? 'added' : e.to === 'reopened' ? 'reopened' : 'completed'} subtask “${e.note ?? ''}”`;
    case 'time':
      return `logged ${formatMinutes(Number(e.to ?? 0))}`;
    case 'linked':
      return `linked ${e.to}`;
  }
}

export const eventKindLabel: Record<TaskEventKind, string> = {
  created: 'Created',
  status: 'Status',
  assignee: 'Assignment',
  reviewer: 'Reviewer',
  priority: 'Priority',
  due: 'Due date',
  estimate: 'Estimate',
  comment: 'Comment',
  subtask: 'Subtask',
  time: 'Time logged',
  linked: 'Code linked',
};
