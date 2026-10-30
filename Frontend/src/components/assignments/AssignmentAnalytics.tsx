import { useMemo } from 'react';
import { MetricCard } from '../analytics/MetricCard';
import { MiniBars } from '../analytics/MiniBars';
import { MiniLine } from '../analytics/MiniLine';
import { SegmentBar } from '../analytics/SegmentBar';
import { Avatar } from '../ui/Avatar';
import { useWork } from '../../contexts/WorkContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { firstName } from '../../utils/status';
import {
  cycleBands,
  cycleHistogram,
  cycleTimes,
  doneEvent,
  median,
  overdueSeries,
} from '../../utils/metrics';
import type { Task } from '../../types/work';

/** Side column on Assignments: who ships, how long work takes, overdue drift and how often work is reassigned. */
export function AssignmentAnalytics({ tasks }: { tasks: Task[] }) {
  const { events } = useWork();
  const { from, to, inRange } = useDateRange();

  const d = useMemo(() => {
    const keys = new Set(tasks.map((t) => t.key));
    const perPerson = new Map<string, number>();
    tasks.forEach((t) => {
      const e = doneEvent(events, t.key);
      if (e && inRange(new Date(e.at)))
        perPerson.set(t.assignee, (perPerson.get(t.assignee) ?? 0) + 1);
    });
    const people = [...perPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const cycles = cycleTimes(events, keys, inRange);
    const assigns = events.filter(
      (e) => keys.has(e.taskKey) && e.kind === 'assignee' && inRange(new Date(e.at)),
    );
    const reassigns = assigns.filter((e) => e.from).length;
    return {
      people,
      cycles,
      overdue: overdueSeries(tasks, events, from, to),
      assigns: assigns.length,
      reassigns,
    };
  }, [tasks, events, inRange, from, to]);

  const maxDone = Math.max(1, ...d.people.map((p) => p[1]));
  const rate = d.assigns ? Math.round((d.reassigns / d.assigns) * 100) : 0;

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
      <MetricCard
        label="Throughput by person"
        value={d.people.reduce((s, p) => s + p[1], 0)}
        unit="done"
        source="task history"
      >
        {d.people.length === 0 ? (
          <p className="text-[11.5px] text-muted">Nothing completed in this range.</p>
        ) : (
          <ul className="space-y-1">
            {d.people.map(([id, n]) => (
              <li
                key={id}
                className="grid grid-cols-[18px_64px_minmax(0,1fr)_20px] items-center gap-1.5 text-[11.5px]"
              >
                <Avatar id={id} size="xs" />
                <span className="truncate text-ink">{firstName(id)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(n / maxDone) * 100}%` }}
                  />
                </span>
                <span className="text-right font-semibold tabular-nums text-ink">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </MetricCard>
      <MetricCard
        label="Cycle-time spread"
        value={d.cycles.length ? median(d.cycles).toFixed(1) : '—'}
        unit={d.cycles.length ? 'days median' : undefined}
        source="status changes"
      >
        <MiniBars
          values={cycleHistogram(d.cycles)}
          labels={cycleBands.map((b) => b.label)}
          showLabels
          tone="info"
          label="Cycle-time distribution"
        />
      </MetricCard>
      <MetricCard
        label="Overdue trend"
        value={d.overdue.values[d.overdue.values.length - 1] ?? 0}
        unit="open overdue"
        source="due dates"
      >
        <MiniLine
          values={d.overdue.values}
          labels={d.overdue.labels}
          tone="warn"
          label="Overdue tasks over time"
        />
      </MetricCard>
      <MetricCard
        label="Reassignment rate"
        value={`${rate}%`}
        unit={`${d.reassigns} of ${d.assigns}`}
        source="assignment history"
      >
        <SegmentBar
          label="Assignments"
          segments={[
            { label: 'First assignment', value: d.assigns - d.reassigns, tone: 'ok' },
            { label: 'Reassigned', value: d.reassigns, tone: 'warn' },
          ]}
        />
      </MetricCard>
    </div>
  );
}
