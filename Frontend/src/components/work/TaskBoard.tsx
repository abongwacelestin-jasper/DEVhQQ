import { useState } from 'react';
import { toast } from 'sonner';
import { PlusIcon } from 'lucide-react';
import type { Task, TaskStatus } from '../../types/work';
import { TaskCard } from './TaskCard';
import { useWork } from '../../contexts/WorkContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { taskStatusMeta, toneDot } from '../../utils/status';

const columns: TaskStatus[] = ['backlog', 'in-progress', 'review', 'done'];

export function TaskBoard({ tasks, projectId }: { tasks: Task[]; projectId?: string }) {
  const { updateTask } = useWork();
  const { openCreateTask } = useWorkspaceUI();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  const drop = (status: TaskStatus) => {
    const t = tasks.find((x) => x.key === dragging);
    setOver(null);
    setDragging(null);
    if (!t || t.status === status) return;
    updateTask(t.key, { status });
    toast.success(`${t.key} → ${taskStatusMeta[status].label}`, {
      description: 'Change recorded with your name and the time.',
    });
  };

  return (
    <div className="overflow-x-auto pb-1 scroll-thin">
      <div className="grid min-w-[760px] grid-cols-4 gap-2.5">
        {columns.map((c) => {
          const items = tasks.filter((t) => t.status === c);
          const meta = taskStatusMeta[c];
          const points = items.reduce((s, t) => s + t.estimate, 0);
          return (
            <section
              key={c}
              aria-label={meta.label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(c);
              }}
              onDragLeave={() => setOver((o) => (o === c ? null : o))}
              onDrop={() => drop(c)}
              className={`flex min-w-0 flex-col rounded-lg p-1.5 transition-colors duration-150 ${over === c ? 'bg-accent-soft ring-1 ring-accent/40' : 'bg-sunken/70'}`}
            >
              <header className="flex items-center gap-2 px-1.5 py-1">
                <span className={`h-2 w-2 rounded-full ${toneDot[meta.tone]}`} />
                <h3 className="text-[12px] font-semibold text-ink">{meta.label}</h3>
                <span className="text-[11.5px] tabular-nums text-muted">{items.length}</span>
                <span className="ml-auto text-[11px] tabular-nums text-muted">{points} pts</span>
                {c !== 'done' && (
                  <button
                    onClick={() =>
                      openCreateTask({ status: c === 'review' ? 'in-progress' : c, projectId })
                    }
                    className="rounded p-0.5 text-muted hover:bg-white hover:text-ink"
                    aria-label={`Add task to ${meta.label}`}
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </header>
              <div className="mt-1 flex flex-col gap-1.5">
                {items.map((t) => (
                  <div
                    key={t.key}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(t.key);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={dragging === t.key ? 'opacity-40' : ''}
                  >
                    <TaskCard task={t} />
                  </div>
                ))}
                {items.length === 0 && (
                  <p className="rounded-md border border-dashed border-line-strong px-3 py-5 text-center text-[11.5px] text-muted">
                    Drop tasks here
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
