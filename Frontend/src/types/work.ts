import type { ProductId } from './portfolio';

export type TaskStatus = 'backlog' | 'in-progress' | 'review' | 'done';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';
export type TaskType = 'feature' | 'bug' | 'task' | 'design';
export type ProjectStatus = 'on-track' | 'at-risk' | 'blocked' | 'planned';

export interface Project {
  id: string;
  product: ProductId;
  name: string;
  objective: string;
  status: ProjectStatus;
  lead: string;
  startWeek: number;
  endWeek: number;
  milestone: { name: string; week: number };
  done: number;
  total: number;
}

export interface Task {
  key: string;
  title: string;
  product: ProductId;
  projectId: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  assignee: string;
  reviewer?: string;
  due: string;
  overdue?: boolean;
  pr?: number;
  estimate: number;
  comments: number;
  blockedBy?: string;
  description?: string;
  createdAt?: string;
  createdBy?: string;
}

export type TaskEventKind =
  | 'created'
  | 'status'
  | 'assignee'
  | 'reviewer'
  | 'priority'
  | 'due'
  | 'estimate'
  | 'comment'
  | 'subtask'
  | 'time'
  | 'linked';

/** Every change to a task is recorded as an immutable event: who, what, when. */
export interface TaskEvent {
  id: string;
  taskKey: string;
  actor: string;
  at: string;
  kind: TaskEventKind;
  from?: string;
  to?: string;
  note?: string;
}

export interface Subtask {
  id: string;
  taskKey: string;
  title: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

export interface TimeLog {
  id: string;
  taskKey: string;
  member: string;
  minutes: number;
  at: string;
  note?: string;
}

export interface TaskComment {
  id: string;
  taskKey: string;
  author: string;
  text: string;
  at: string;
}

export interface DocItem {
  id: string;
  product: ProductId;
  title: string;
  kind: 'Spec' | 'Decision' | 'Process' | 'Plan' | 'Meeting notes';
  edited: string;
  author: string;
}

export interface Mention {
  id: string;
  author: string;
  target: string;
  text: string;
  ago: string;
}

export interface Approval {
  id: string;
  product: ProductId;
  title: string;
  detail: string;
  kind: 'deploy' | 'access' | 'release';
  requestedBy: string;
  ago: string;
}
