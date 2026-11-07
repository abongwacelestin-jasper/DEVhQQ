import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { useWork } from '../../contexts/WorkContext';
import { useDirectory } from '../team/useDirectory';
import type { Task } from '../../types/work';

interface Props {
  task: Task | null;
  onClose: () => void;
  field?: 'assignee' | 'reviewer';
}

export function AssignTaskModal({ task, onClose, field = 'assignee' }: Props) {
  const { tasks, updateTask } = useWork();
  const { members } = useDirectory();
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (task) {
      setSelected((field === 'assignee' ? task.assignee : task.reviewer) ?? '');
      setNote('');
    }
  }, [task, field]);

  const eligible = task
    ? members.filter(
        (m) =>
          m.status === 'active' &&
          m.products.includes(task.product) &&
          (field === 'assignee' || m.id !== task.assignee),
      )
    : [];
  const load = (id: string) =>
    tasks
      .filter((t) => t.assignee === id && t.status !== 'done')
      .reduce((s, t) => s + t.estimate, 0);
  const current = task ? (field === 'assignee' ? task.assignee : task.reviewer) : undefined;

  const confirm = () => {
    if (!task || !selected || selected === current) return;
    updateTask(task.key, { [field]: selected }, note.trim() || undefined);
    toast.success(field === 'assignee' ? 'Task reassigned' : 'Reviewer updated', {
      description: `${task.key} · recorded in history and the assignee is notified.`,
    });
    onClose();
  };

  return (
    <Modal
      open={task !== null}
      onClose={onClose}
      title={
        field === 'assignee' ? `Assign ${task?.key ?? ''}` : `Set reviewer for ${task?.key ?? ''}`
      }
      description={task?.title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!selected || selected === current} onClick={confirm}>
            {field === 'assignee' ? 'Assign' : 'Set reviewer'}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-[12px] text-muted">
        Load = open story points vs. capacity this sprint. Only members with access to this product
        are shown.
      </p>
      <ul
        className="divide-y divide-line overflow-hidden rounded-lg border border-line"
        role="radiogroup"
        aria-label="Team members"
      >
        {eligible.map((m) => {
          const l = load(m.id);
          const pct = Math.min(100, (l / m.capacity) * 100);
          const over = l > m.capacity;
          const active = selected === m.id;
          return (
            <li key={m.id}>
              <button
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(m.id)}
                className={`grid w-full grid-cols-[auto_minmax(0,1fr)_110px_auto] items-center gap-3 px-3 py-2 text-left transition-colors duration-150 ${active ? 'bg-accent-soft/60' : 'hover:bg-sunken/60'}`}
              >
                <Avatar id={m.id} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {m.name}{' '}
                    {m.id === current && (
                      <span className="text-[11px] font-normal text-muted">· current</span>
                    )}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">{m.role}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                    <span
                      className={`block h-full rounded-full ${over ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-ok'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span
                    className={`w-10 text-right text-[11.5px] tabular-nums ${over ? 'font-semibold text-bad' : 'text-muted'}`}
                  >
                    {l}/{m.capacity}
                  </span>
                </span>
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? 'border-accent' : 'border-line-strong'}`}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Field
        label="Reason (optional)"
        hint="Shown in the task history next to this change."
        className="mt-3"
      >
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Balancing load before the v2.4 cut"
          className={inputClass}
        />
      </Field>
    </Modal>
  );
}
