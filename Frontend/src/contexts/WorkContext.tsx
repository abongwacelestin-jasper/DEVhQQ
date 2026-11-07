import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import type {
  ApiSubtask,
  ApiTask,
  ApiTaskComment,
  ApiTimeLog,
  TaskActivityResponse,
  TaskListResponse,
} from '../api/types';
import { useAuth } from './AuthContext';
import {
  NOW,
  formatDay,
  fromInputDate,
  nowISO,
  parseWhen,
  startOfDay,
  toInputDate,
} from '../utils/date';
import type { ProductId } from '../types/portfolio';
import type {
  Priority,
  Subtask,
  Task,
  TaskComment,
  TaskEvent,
  TaskStatus,
  TaskType,
  TimeLog,
} from '../types/work';

export interface NewTaskInput {
  title: string;
  product: ProductId;
  projectId: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  assignee: string;
  reviewer?: string;
  due: string;
  estimate: number;
  description?: string;
}

export type TaskPatch = Partial<
  Pick<Task, 'status' | 'assignee' | 'reviewer' | 'priority' | 'due' | 'estimate'>
>;

interface WorkValue {
  tasks: Task[];
  events: TaskEvent[];
  comments: TaskComment[];
  subtasks: Subtask[];
  timeLogs: TimeLog[];
  createTask: (input: NewTaskInput) => Promise<string>;
  updateTask: (key: string, patch: TaskPatch, note?: string) => void;
  addComment: (key: string, text: string) => void;
  addSubtask: (key: string, title: string) => void;
  toggleSubtask: (id: string) => void;
  logTime: (key: string, minutes: number, note?: string) => void;
  lastActivity: (key: string) => Date;
  /** Re-reads tasks and their activity from the API. Exposed so failures are recoverable. */
  reload: () => Promise<void>;
}

export function isOverdue(t: Task) {
  return t.status !== 'done' && parseWhen(t.due) < startOfDay(NOW);
}

/** The API stores dates as ISO; the work views display and accept "Oct 28". */
const toApiDate = (due: string) => toInputDate(parseWhen(due));
/** ISO dates are parsed as local days, so a negative timezone can't shift the date. */
const toUiDate = (due: string) =>
  formatDay(/^\d{4}-\d{2}-\d{2}$/.test(due) ? fromInputDate(due) : parseWhen(due));

function toTask(t: ApiTask): Task {
  return {
    key: t.key,
    title: t.title,
    product: t.product,
    projectId: t.projectId,
    type: t.type,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee,
    reviewer: t.reviewer,
    due: toUiDate(t.due),
    overdue: t.overdue,
    pr: t.pr,
    estimate: t.estimate,
    comments: t.comments,
    blockedBy: t.blockedBy,
    description: t.description,
    createdAt: t.createdAt,
    createdBy: t.createdBy,
  };
}

const tempId = (prefix: string) =>
  `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

const WorkContext = createContext<WorkValue | null>(null);

export function WorkProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const memberId = session?.memberId ?? null;
  /** Optimistic rows are attributed to the session's member; the server's resync is authoritative. */
  const me = memberId ?? '';

  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);

  const reload = useCallback(async () => {
    const [list, activity] = await Promise.all([
      api<TaskListResponse>('/api/tasks?limit=200'),
      api<TaskActivityResponse>('/api/tasks/_activity'),
    ]);
    setTasks(list.items.map(toTask));
    setEvents(activity.events);
    setComments(activity.comments);
    setSubtasks(activity.subtasks);
    setTimeLogs(activity.timeLogs);
  }, []);

  // Load on sign-in, and clear on sign-out so another account never sees this one's work.
  useEffect(() => {
    if (!memberId) {
      setTasks([]);
      setEvents([]);
      setComments([]);
      setSubtasks([]);
      setTimeLogs([]);
      return;
    }
    let alive = true;
    reload().catch((e) => {
      if (!alive) return;
      toast.error("Couldn't load work data", {
        description: e instanceof Error ? e.message : 'The task API did not respond.',
      });
    });
    return () => {
      alive = false;
    };
  }, [memberId, reload]);

  /** One place to handle a failed write: say so, then resync with the server. */
  const failed = useCallback(
    (action: string, e: unknown) => {
      toast.error(`${action} failed`, {
        description: e instanceof Error ? e.message : 'The task API did not respond.',
      });
      void reload().catch(() => undefined);
    },
    [reload],
  );

  const record = useCallback(
    (e: Omit<TaskEvent, 'id' | 'at' | 'actor'>) => {
      setEvents((list) => [
        ...list,
        {
          ...e,
          id: tempId('ev'),
          at: nowISO(),
          actor: me,
        },
      ]);
    },
    [me],
  );

  const createTask = useCallback(
    async (input: NewTaskInput) => {
      try {
        const created = await api<ApiTask>('/api/tasks', {
          method: 'POST',
          body: {
            projectId: input.projectId,
            title: input.title,
            type: input.type,
            status: input.status,
            priority: input.priority,
            assignee: input.assignee,
            reviewer: input.reviewer,
            due: toApiDate(input.due),
            estimate: input.estimate,
            description: input.description,
          },
        });
        // The create response is authoritative; activity is fetched so the
        // "created" and assignment events appear without a second mutation.
        await reload();
        return created.key;
      } catch (e) {
        failed('Creating the task', e);
        throw e;
      }
    },
    [failed, reload],
  );

  const updateTask = useCallback(
    (key: string, patch: TaskPatch, note?: string) => {
      const current = tasks.find((t) => t.key === key);
      if (!current) return;
      const changed = (Object.keys(patch) as (keyof TaskPatch)[]).filter(
        (field) => patch[field] !== undefined && patch[field] !== current[field],
      );
      if (!changed.length) return;

      changed.forEach((field) => {
        const from = current[field];
        const to = patch[field];
        record({
          taskKey: key,
          kind: field,
          from: from === undefined ? undefined : String(from),
          to: to === undefined ? undefined : String(to),
          note,
        });
      });
      setTasks((l) =>
        l.map((t) => {
          if (t.key !== key) return t;
          const next = { ...t, ...patch };
          return { ...next, overdue: isOverdue(next) };
        }),
      );

      const body = Object.fromEntries(
        changed.map((field) => [
          field,
          field === 'due' ? toApiDate(String(patch.due)) : patch[field],
        ]),
      );
      api<ApiTask>(`/api/tasks/${encodeURIComponent(key)}`, { method: 'PATCH', body }).catch((e) =>
        failed('Saving the change', e),
      );
    },
    [tasks, record, failed],
  );

  const addComment = useCallback(
    (key: string, text: string) => {
      setComments((l) => [
        ...l,
        { id: tempId('tc'), taskKey: key, author: me, text, at: nowISO() },
      ]);
      setTasks((l) => l.map((t) => (t.key === key ? { ...t, comments: t.comments + 1 } : t)));
      record({
        taskKey: key,
        kind: 'comment',
        note: text.length > 80 ? `${text.slice(0, 80)}…` : text,
      });
      api<ApiTaskComment>(`/api/tasks/${encodeURIComponent(key)}/comments`, {
        method: 'POST',
        body: { text },
      }).catch((e) => failed('Posting the comment', e));
    },
    [record, failed, me],
  );

  const addSubtask = useCallback(
    (key: string, title: string) => {
      setSubtasks((l) => [...l, { id: tempId('st'), taskKey: key, title, done: false }]);
      record({ taskKey: key, kind: 'subtask', to: 'added', note: title });
      api<ApiSubtask>(`/api/tasks/${encodeURIComponent(key)}/subtasks`, {
        method: 'POST',
        body: { title },
      }).catch((e) => failed('Adding the subtask', e));
    },
    [record, failed],
  );

  const toggleSubtask = useCallback(
    (id: string) => {
      const s = subtasks.find((x) => x.id === id);
      if (!s) return;
      const done = !s.done;
      setSubtasks((l) =>
        l.map((x) =>
          x.id === id
            ? {
                ...x,
                done,
                doneBy: done ? me : undefined,
                doneAt: done ? nowISO() : undefined,
              }
            : x,
        ),
      );
      record({
        taskKey: s.taskKey,
        kind: 'subtask',
        to: done ? 'completed' : 'reopened',
        note: s.title,
      });
      api<ApiSubtask>(`/api/tasks/${encodeURIComponent(s.taskKey)}/subtasks/${id}`, {
        method: 'PATCH',
        body: { done },
      }).catch((e) => failed('Updating the subtask', e));
    },
    [subtasks, record, failed, me],
  );

  const logTime = useCallback(
    (key: string, minutes: number, note?: string) => {
      setTimeLogs((l) => [
        ...l,
        { id: tempId('tl'), taskKey: key, member: me, minutes, at: nowISO(), note },
      ]);
      record({ taskKey: key, kind: 'time', to: String(minutes), note });
      api<ApiTimeLog>(`/api/tasks/${encodeURIComponent(key)}/time`, {
        method: 'POST',
        body: { minutes, note },
      }).catch((e) => failed('Logging time', e));
    },
    [record, failed, me],
  );

  const lastActivity = useCallback(
    (key: string) => {
      const times = events.filter((e) => e.taskKey === key).map((e) => new Date(e.at).getTime());
      return new Date(times.length ? Math.max(...times) : 0);
    },
    [events],
  );

  const value = useMemo(
    () => ({
      tasks,
      events,
      comments,
      subtasks,
      timeLogs,
      createTask,
      updateTask,
      addComment,
      addSubtask,
      toggleSubtask,
      logTime,
      lastActivity,
      reload,
    }),
    [
      tasks,
      events,
      comments,
      subtasks,
      timeLogs,
      createTask,
      updateTask,
      addComment,
      addSubtask,
      toggleSubtask,
      logTime,
      lastActivity,
      reload,
    ],
  );

  return <WorkContext.Provider value={value}>{children}</WorkContext.Provider>;
}

export function useWork() {
  const ctx = useContext(WorkContext);
  if (!ctx) throw new Error('useWork must be used inside WorkProvider');
  return ctx;
}

/** A task is "in range" when it was created, changed, or is due inside the selected dates. */
export function useTaskInRange() {
  const { events } = useWork();
  return useCallback(
    (t: Task, inRange: (d: Date) => boolean) =>
      inRange(parseWhen(t.due)) ||
      (t.createdAt ? inRange(new Date(t.createdAt)) : false) ||
      events.some((e) => e.taskKey === t.key && inRange(new Date(e.at))),
    [events],
  );
}
