import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ServerIcon } from 'lucide-react';
import { MetricCard } from '../analytics/MetricCard';
import { MiniBars } from '../analytics/MiniBars';
import { MiniLine } from '../analytics/MiniLine';
import { SegmentBar } from '../analytics/SegmentBar';
import { useIncidents } from '../../contexts/IncidentContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import {
  formatDuration,
  incidentRecords,
  incidentsPerBucket,
  mttr,
  mttrPerBucket,
  severityCounts,
  weekBuckets,
} from '../../utils/metrics';

/**
 * Side column on the Incidents page.
 *
 * Everything is computed from the incidents the API returned for this scope —
 * there is no seeded history, so a workspace with three incidents shows three,
 * and MTTR is blank until something has actually been resolved.
 */
export function IncidentAnalytics() {
  const { incidents } = useIncidents();
  const { from, to, inRange } = useDateRange();
  const { matches } = useProductFilter();

  const d = useMemo(() => {
    const records = incidentRecords(incidents).filter((r) => matches(r.product));
    const ranged = records.filter((r) => inRange(r.started));
    const resolved = ranged.filter((r) => r.minutes !== null);
    const byService = new Map<string, number>();
    ranged.forEach((r) => byService.set(r.service, (byService.get(r.service) ?? 0) + 1));
    return {
      buckets: weekBuckets(from, to),
      records,
      ranged,
      resolved,
      mttrNow: mttr(ranged),
      sev: severityCounts(ranged),
      services: [...byService.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [incidents, matches, inRange, from, to]);

  const labels = d.buckets.map((b) => b.label);

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
      <MetricCard
        label="MTTR trend"
        value={formatDuration(d.mttrNow)}
        source={`${d.resolved.length} resolved`}
      >
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
        source="incident log"
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
        label="Services affected"
        value={d.services.length}
        unit="with incidents"
        source="incident log"
      >
        {d.services.length === 0 ? (
          <p className="text-[11.5px] text-muted">No incidents in this range.</p>
        ) : (
          <ul className="space-y-1">
            {d.services.map(([service, count]) => (
              <li
                key={service}
                className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2 text-[11.5px]"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ServerIcon className="h-3 w-3 shrink-0 text-subtle" />
                  <span className="truncate text-ink">{service}</span>
                </span>
                <span className="text-right font-semibold tabular-nums text-ink">{count}</span>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/incidents?status=resolved"
          className="mt-1.5 block text-[11.5px] font-medium text-accent hover:underline"
        >
          Review resolved incidents
        </Link>
      </MetricCard>
    </div>
  );
}
