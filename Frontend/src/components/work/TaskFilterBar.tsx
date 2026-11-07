import React, { useCallback, useState } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';
import { useDirectory } from '../team/useDirectory';
import { priorityMeta } from '../../utils/status';
import type { Priority, Task, TaskType } from '../../types/work';

export interface TaskFilters {
  q: string;
  assignee: string;
  priority: Priority | '';
  type: TaskType | '';
  overdueOnly: boolean;
}

const empty: TaskFilters = { q: '', assignee: '', priority: '', type: '', overdueOnly: false };

export function useTaskFilters() {
  const [filters, setFilters] = useState<TaskFilters>(empty);
  const apply = useCallback(
    (t: Task) =>
      (!filters.q || `${t.key} ${t.title}`.toLowerCase().includes(filters.q.toLowerCase())) &&
      (!filters.assignee || t.assignee === filters.assignee) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.type || t.type === filters.type) &&
      (!filters.overdueOnly || !!t.overdue),
    [filters],
  );
  const active =
    filters.q !== '' ||
    filters.assignee !== '' ||
    filters.priority !== '' ||
    filters.type !== '' ||
    filters.overdueOnly;
  return { filters, setFilters, apply, active, reset: () => setFilters(empty) };
}

const selectClass =
  'h-7 min-w-0 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink';

export function TaskFilterBar({
  filters,
  setFilters,
  active,
  reset,
  count,
}: {
  filters: TaskFilters;
  setFilters: React.Dispatch<React.SetStateAction<TaskFilters>>;
  active: boolean;
  reset: () => void;
  count: number;
}) {
  const { members } = useDirectory();
  const set = <K extends keyof TaskFilters>(k: K, v: TaskFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="relative min-w-0 flex-1 basis-40 sm:max-w-[220px]">
        <span className="sr-only">Search tasks</span>
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Search tasks…"
          className="h-7 w-full rounded-md border border-line bg-white pl-7 pr-2 text-[12px] text-ink outline-none placeholder:text-subtle focus:border-accent"
        />
      </label>
      <select
        aria-label="Assignee"
        value={filters.assignee}
        onChange={(e) => set('assignee', e.target.value)}
        className={selectClass}
      >
        <option value="">Anyone</option>
        {members
          .filter((m) => m.status === 'active')
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>
      <select
        aria-label="Priority"
        value={filters.priority}
        onChange={(e) => set('priority', e.target.value as Priority | '')}
        className={selectClass}
      >
        <option value="">Any priority</option>
        {(Object.keys(priorityMeta) as Priority[]).map((p) => (
          <option key={p} value={p}>
            {priorityMeta[p].label}
          </option>
        ))}
      </select>
      <select
        aria-label="Type"
        value={filters.type}
        onChange={(e) => set('type', e.target.value as TaskType | '')}
        className={selectClass}
      >
        <option value="">Any type</option>
        <option value="feature">Feature</option>
        <option value="bug">Bug</option>
        <option value="task">Task</option>
        <option value="design">Design</option>
      </select>
      <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-ink">
        <input
          type="checkbox"
          checked={filters.overdueOnly}
          onChange={(e) => set('overdueOnly', e.target.checked)}
          className="h-3.5 w-3.5 accent-[#B42318]"
        />
        Overdue
      </label>
      {active && (
        <button
          onClick={reset}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-sunken hover:text-ink"
        >
          <XIcon className="h-3.5 w-3.5" /> Clear
        </button>
      )}
      <span className="ml-auto text-[11.5px] tabular-nums text-muted">{count} tasks</span>
    </div>
  );
}
