import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PhoneCallIcon } from 'lucide-react';
import { MetricCard } from '../analytics/MetricCard';
import { MiniLine } from '../analytics/MiniLine';
import { MiniBars } from '../analytics/MiniBars';
import { SegmentBar } from '../analytics/SegmentBar';
import { Avatar } from '../ui/Avatar';
import { useIncidents } from '../../contexts/IncidentContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { monitors } from '../../data/operations';
import { onCall, pastIncidents } from '../../data/incidentHistory';
import { memberById } from '../../utils/status';
import {
  formatDuration,
  incidentRecords,
  incidentsPerBucket,
  mttr,
  mttrPerBucket,
  severityCounts,
  weekBuckets,
} from '../../utils/metrics';

/** Side column on the Incidents page: MTTR trend, severity mix, uptime by service and who is on call. */
export function IncidentAnalytics() {
  const { incidents } = useIncidents();
  const { from, to, inRange } = useDateRange();
  const { matches } = useProductFilter();

  const d = useMemo(() => {
    const records = incidentRecords(incidents, pastIncidents).filter((r) => matches(r.product));
    const ranged = records.filter((r) => inRange(r.started));
    const buckets = weekBuckets(from, to);
    return { buckets, records, ranged, mttrNow: mttr(ranged), sev: severityCounts(ranged) };
  }, [incidents, matches, inRange, from, to]);

  const labels = d.buckets.map((b) => b.label);
  const mons = monitors.filter((m) => matches(m.product)).sort((a, b) => a.uptime - b.uptime);

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
      <MetricCard label="MTTR trend" value={formatDuration(d.mttrNow)} source="resolved incidents">
        <MiniLine
          values={mttrPerBucket(d.records, d.buckets)}
          labels={labels}
          tone="bad"
          label="Mean time to resolve per week"
        />
      </MetricCard>
      <MetricCard
        label="Incidents by severity"
        value={d.ranged.length}
        unit="in range"
        source="alerts"
      >
        <MiniBars
          values={incidentsPerBucket(d.records, d.buckets)}
          labels={labels}
          tone="bad"
          height={26}
          label="Incidents per week"
        />
        <div className="mt-1.5">
          <SegmentBar
            label="Severity mix"
            segments={[
              { label: 'SEV1', value: d.sev.SEV1, tone: 'bad' },
              { label: 'SEV2', value: d.sev.SEV2, tone: 'warn' },
              { label: 'SEV3', value: d.sev.SEV3, tone: 'neutral' },
            ]}
          />
        </div>
      </MetricCard>
      <MetricCard
        label="Uptime by service"
        value={`${(mons.reduce((s, m) => s + m.uptime, 0) / Math.max(1, mons.length)).toFixed(2)}%`}
        unit="30d avg"
        source="monitors"
      >
        <ul className="space-y-1">
          {mons.map((m) => (
            <li
              key={m.id}
              className="grid grid-cols-[8px_minmax(0,1fr)_48px] items-center gap-2 text-[11.5px]"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${m.status === 'up' ? 'bg-ok' : m.status === 'degraded' ? 'bg-warn' : 'bg-bad'}`}
              />
              <span className="truncate text-ink">{m.name}</span>
              <span
                className={`text-right font-semibold tabular-nums ${m.uptime < 99.5 ? 'text-bad' : 'text-ink'}`}
              >
                {m.uptime}%
              </span>
            </li>
          ))}
        </ul>
        <Link
          to="/monitors"
          className="mt-1.5 block text-[11.5px] font-medium text-accent hover:underline"
        >
          All monitors
        </Link>
      </MetricCard>
      <section className="rounded-lg border border-line bg-white px-3 py-2.5" aria-label="On call">
        <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
          <PhoneCallIcon className="h-3.5 w-3.5 text-accent" /> On call now
        </h3>
        <ul className="mt-1.5 space-y-1.5">
          {onCall.map((o) => (
            <li key={o.member} className="flex items-center gap-2">
              <Avatar id={o.member} size="sm" />
              <span className="min-w-0 flex-1">
                <Link
                  to={`/team/${o.member}`}
                  className="block truncate text-[12px] font-semibold text-ink hover:underline"
                >
                  {memberById(o.member).name}
                </Link>
                <span className="block text-[11px] text-muted">
                  {o.role} · until {o.until}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
