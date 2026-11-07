import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightIcon, ScaleIcon } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { ProductMark } from '../ui/ProductMark';
import { EmptyIllustration } from '../illustrations/EmptyIllustration';
import { useWork } from '../../contexts/WorkContext';
import { useDirectory } from '../team/useDirectory';
import { firstName } from '../../utils/status';
import type { Task } from '../../types/work';

interface Suggestion {
  task: Task;
  from: string;
  to: string;
}

/** Suggests moving not-yet-started work off people who are over capacity, previews the effect, then records each move. */
export function RebalanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tasks, updateTask } = useWork();
  const { members, memberById } = useDirectory();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const { suggestions, before } = useMemo(() => {
    const active = members.filter((m) => m.status === 'active' && m.role !== 'Owner');
    const load = new Map(
      active.map((m) => [
        m.id,
        tasks
          .filter((t) => t.assignee === m.id && t.status !== 'done')
          .reduce((s, t) => s + t.estimate, 0),
      ]),
    );
    const snapshot = new Map(load);
    const out: Suggestion[] = [];
    active
      .filter((m) => (load.get(m.id) ?? 0) > m.capacity)
      .forEach((m) => {
        const movable = tasks
          .filter((t) => t.assignee === m.id && t.status === 'backlog')
          .sort((a, b) => a.estimate - b.estimate);
        for (const t of movable) {
          if ((load.get(m.id) ?? 0) <= m.capacity) break;
          const target = active
            .filter(
              (c) =>
                c.id !== m.id &&
                c.products.includes(t.product) &&
                (c.role === m.role || c.role === 'Developer') &&
                (load.get(c.id) ?? 0) + t.estimate <= c.capacity,
            )
            .sort(
              (a, b) => (load.get(a.id) ?? 0) / a.capacity - (load.get(b.id) ?? 0) / b.capacity,
            )[0];
          if (!target) continue;
          out.push({ task: t, from: m.id, to: target.id });
          load.set(m.id, (load.get(m.id) ?? 0) - t.estimate);
          load.set(target.id, (load.get(target.id) ?? 0) + t.estimate);
        }
      });
    return { suggestions: out, before: snapshot };
  }, [members, tasks]);

  useEffect(() => {
    if (open) setPicked(new Set(suggestions.map((s) => s.task.key)));
  }, [open, suggestions]);

  const projected = new Map(before);
  suggestions
    .filter((s) => picked.has(s.task.key))
    .forEach((s) => {
      projected.set(s.from, (projected.get(s.from) ?? 0) - s.task.estimate);
      projected.set(s.to, (projected.get(s.to) ?? 0) + s.task.estimate);
    });
  const affected = Array.from(new Set(suggestions.flatMap((s) => [s.from, s.to])));

  const apply = () => {
    const chosen = suggestions.filter((s) => picked.has(s.task.key));
    chosen.forEach((s) =>
      updateTask(
        s.task.key,
        { assignee: s.to },
        `Rebalanced — ${firstName(s.from)} was over capacity`,
      ),
    );
    toast.success(`${chosen.length} task${chosen.length === 1 ? '' : 's'} rebalanced`, {
      description: 'Each move is recorded in the task history with the reason.',
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rebalance workload"
      description="Only backlog work moves, and only to people who already have access to that product and stay within capacity."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            icon={<ScaleIcon className="h-3.5 w-3.5" />}
            onClick={apply}
          >
            Apply {picked.size} move{picked.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {suggestions.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <EmptyIllustration className="h-20 w-auto" />
          <p className="mt-2 text-[13px] font-semibold text-ink">Nothing to rebalance</p>
          <p className="text-[12px] text-muted">
            Everyone is within capacity, or no backlog work can move safely.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {suggestions.map((s) => {
              const on = picked.has(s.task.key);
              return (
                <li key={s.task.key}>
                  <label className="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 hover:bg-sunken/50">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(s.task.key)) n.delete(s.task.key);
                          else n.add(s.task.key);
                          return n;
                        })
                      }
                      className="h-3.5 w-3.5 accent-[#4F46E5]"
                    />

                    <span className="flex min-w-0 items-center gap-2">
                      <ProductMark product={s.task.product} size="sm" />
                      <span className="font-mono text-[11.5px] text-muted">{s.task.key}</span>
                      <span className="truncate text-[12.5px] font-medium text-ink">
                        {s.task.title}
                      </span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-muted">
                        {s.task.estimate}p
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[12px] text-ink">
                      <Avatar id={s.from} size="xs" />
                      <span className="hidden sm:inline">{firstName(s.from)}</span>
                      <ArrowRightIcon className="h-3.5 w-3.5 text-muted" />
                      <Avatar id={s.to} size="xs" />
                      <span className="hidden font-semibold sm:inline">{firstName(s.to)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-ink">
              Preview · load after applying
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {affected.map((id) => {
                const m = memberById(id);
                const b = before.get(id) ?? 0;
                const a = projected.get(id) ?? 0;
                return (
                  <li
                    key={id}
                    className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-sunken/60 px-2.5 py-1.5 text-[12px]"
                  >
                    <Avatar id={id} size="xs" />
                    <span className="truncate text-ink">{m.name}</span>
                    <span className="tabular-nums">
                      <span className={b > m.capacity ? 'text-bad' : 'text-muted'}>{b}</span>
                      <span className="mx-1 text-muted">→</span>
                      <span className={`font-semibold ${a > m.capacity ? 'text-bad' : 'text-ok'}`}>
                        {a}
                      </span>
                      <span className="text-muted">/{m.capacity}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
