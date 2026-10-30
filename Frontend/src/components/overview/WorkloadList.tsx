import type { Member } from '../../types/team';
import { Avatar } from '../ui/Avatar';

export function WorkloadList({ items }: { items: Member[] }) {
  const max = Math.max(...items.map((m) => Math.max(m.openTasks, m.capacity)));
  return (
    <ul className="space-y-2.5 px-4 py-3.5">
      {items.map((m) => {
        const over = m.openTasks > m.capacity;
        const high = !over && m.openTasks / m.capacity >= 0.8;
        return (
          <li key={m.id} className="flex items-center gap-3">
            <Avatar id={m.id} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-medium text-ink">{m.name}</span>
                <span className={`tabular-nums ${over ? 'font-semibold text-bad' : 'text-muted'}`}>
                  {m.openTasks}/{m.capacity}
                </span>
              </div>
              <div className="relative mt-1.5 h-1.5 rounded-full bg-sunken">
                <div
                  className={`h-full rounded-full ${over ? 'bg-bad' : high ? 'bg-warn' : 'bg-accent'}`}
                  style={{ width: `${(m.openTasks / max) * 100}%` }}
                />

                <span
                  className="absolute top-[-3px] h-3 w-px bg-ink/40"
                  style={{ left: `${(m.capacity / max) * 100}%` }}
                  aria-hidden
                />
              </div>
            </div>
          </li>
        );
      })}
      <li className="pt-1 text-[11px] text-subtle">
        Tick marks each person’s capacity. Derived from open assigned tasks.
      </li>
    </ul>
  );
}
