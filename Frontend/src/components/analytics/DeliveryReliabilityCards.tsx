import { useMemo } from 'react';
import { MetricCard } from './MetricCard';
import { MiniLine } from './MiniLine';
import { MiniBars } from './MiniBars';
import { SegmentBar } from './SegmentBar';
import { useWork } from '../../contexts/WorkContext';
import { useIncidents } from '../../contexts/IncidentContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { deployments, monitors } from '../../data/operations';
import { pastIncidents } from '../../data/incidentHistory';
import {
  cycleBands,
  cycleHistogram,
  cycleTimes,
  deployStats,
  formatDuration,
  incidentRecords,
  incidentsPerBucket,
  median,
  mttr,
  mttrPerBucket,
  overdueSeries,
  severityCounts,
  throughputByWeek,
  uptimeAvg,
  weekBuckets,
  weekDelta,
} from '../../utils/metrics';
import type { ProductId } from '../../types/portfolio';

interface Props {
  match: (p: ProductId) => boolean;
  size?: 'compact' | 'large';
  className?: string;
}

/** Six delivery + reliability cards, all following the global date range. */
export function DeliveryReliabilityCards({ match, size = 'compact', className = '' }: Props) {
  const { tasks, events } = useWork();
  const { incidents } = useIncidents();
  const { from, to, inRange } = useDateRange();
  const h = size === 'large' ? 72 : 34;

  const data = useMemo(() => {
    const scoped = tasks.filter((t) => match(t.product));
    const keys = new Set(scoped.map((t) => t.key));
    const buckets = weekBuckets(from, to);
    const labels = buckets.map((b) => b.label);
    const throughput = throughputByWeek(events, keys, buckets);
    const cycles = cycleTimes(events, keys, inRange);
    const overdue = overdueSeries(scoped, events, from, to);
    const records = incidentRecords(incidents, pastIncidents).filter((r) => match(r.product));
    const recordsInRange = records.filter((r) => inRange(r.started));
    const mons = monitors.filter((m) => match(m.product));
    return {
      labels,
      throughput,
      cycles,
      overdue,
      mttrNow: mttr(recordsInRange),
      mttrLine: mttrPerBucket(records, buckets),
      freq: incidentsPerBucket(records, buckets),
      sev: severityCounts(recordsInRange),
      mons,
      deploys: deployStats(
        deployments.filter((d) => match(d.product)),
        inRange,
      ),
    };
  }, [tasks, events, incidents, from, to, inRange, match]);

  const grid =
    size === 'large'
      ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
      : 'grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1';

  return (
    <div className={`${grid} ${className}`}>
      <MetricCard
        size={size}
        label="Throughput"
        value={data.throughput.reduce((s, v) => s + v, 0)}
        unit="done"
        delta={weekDelta(data.throughput)}
        source="task history"
      >
        <MiniBars
          values={data.throughput}
          labels={data.labels}
          height={h}
          label="Tasks done per week"
        />
      </MetricCard>
      <MetricCard
        size={size}
        label="Cycle time"
        value={data.cycles.length ? median(data.cycles).toFixed(1) : '—'}
        unit={data.cycles.length ? 'days median' : undefined}
        source="status changes"
      >
        <MiniBars
          values={cycleHistogram(data.cycles)}
          labels={cycleBands.map((b) => b.label)}
          showLabels
          tone="info"
          height={h}
          label="Cycle-time distribution"
        />
      </MetricCard>
      <MetricCard
        size={size}
        label="Overdue trend"
        value={data.overdue.values[data.overdue.values.length - 1] ?? 0}
        unit="open overdue"
        delta={weekDelta(data.overdue.values.slice(-2), false)}
        source="due dates"
      >
        <MiniLine
          values={data.overdue.values}
          labels={data.overdue.labels}
          tone="warn"
          height={h}
          label="Overdue tasks over time"
        />
      </MetricCard>
      <MetricCard size={size} label="MTTR" value={formatDuration(data.mttrNow)} source="incidents">
        <MiniLine
          values={data.mttrLine}
          labels={data.labels}
          tone="bad"
          height={h}
          label="Mean time to resolve per week, minutes"
        />
      </MetricCard>
      <MetricCard
        size={size}
        label="Incident frequency"
        value={data.sev.SEV1 + data.sev.SEV2 + data.sev.SEV3}
        unit="in range"
        source="alerts"
      >
        <MiniBars
          values={data.freq}
          labels={data.labels}
          tone="bad"
          height={Math.round(h * 0.6)}
          label="Incidents per week"
        />
        <div className="mt-1.5">
          <SegmentBar
            label="Incidents by severity"
            segments={[
              { label: 'SEV1', value: data.sev.SEV1, tone: 'bad' },
              { label: 'SEV2', value: data.sev.SEV2, tone: 'warn' },
              { label: 'SEV3', value: data.sev.SEV3, tone: 'neutral' },
            ]}
          />
        </div>
      </MetricCard>
      <MetricCard
        size={size}
        label="Uptime · failed deploys"
        value={`${uptimeAvg(data.mons).toFixed(2)}%`}
        source="monitors · deploys"
      >
        <ul className="space-y-1">
          {data.mons.slice(0, size === 'large' ? 6 : 3).map((m) => (
            <li
              key={m.id}
              className="grid grid-cols-[minmax(0,1fr)_64px_42px] items-center gap-2 text-[11px]"
            >
              <span className="truncate text-ink">{m.name}</span>
              <span className="h-1 overflow-hidden rounded-full bg-sunken">
                <span
                  className={`block h-full ${m.uptime >= 99.9 ? 'bg-ok' : m.uptime >= 99.5 ? 'bg-warn' : 'bg-bad'}`}
                  style={{ width: `${Math.max(4, (m.uptime - 98) * 50)}%` }}
                />
              </span>
              <span className="text-right font-medium tabular-nums text-ink">{m.uptime}%</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-ink">
          <span className={`font-semibold ${data.deploys.rate > 15 ? 'text-bad' : 'text-ok'}`}>
            {data.deploys.rate.toFixed(0)}%
          </span>{' '}
          failed deploys{' '}
          <span className="text-muted">
            ({data.deploys.failed} of {data.deploys.total})
          </span>
        </p>
      </MetricCard>
    </div>
  );
}
