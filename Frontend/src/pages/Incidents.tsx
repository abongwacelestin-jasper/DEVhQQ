import { useCallback, useMemo } from 'react';
import { SirenIcon } from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { Button } from '../components/ui/Button';
import { FilterBar } from '../components/filters/FilterBar';
import { StatCard, StatStrip } from '../components/ui/StatCard';
import { FirefighterIllustration } from '../components/illustrations/FirefighterIllustration';
import { EmptyIllustration } from '../components/illustrations/EmptyIllustration';
import { IncidentRow, IncidentRowHeader } from '../components/operations/IncidentRow';
import { IncidentAnalytics } from '../components/operations/IncidentAnalytics';
import { useIncidents } from '../contexts/IncidentContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useDateRange } from '../contexts/DateRangeContext';
import { useAuth } from '../contexts/AuthContext';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { members } from '../data/team';
import { parseWhen } from '../utils/date';
import { formatDuration, incidentRecords, mttr } from '../utils/metrics';
import type { Incident } from '../types/operations';

const keys = ['q', 'severity', 'status', 'product', 'service', 'owner'] as const;
const groups: { status: Incident['status']; title: string; tone: string }[] = [
  { status: 'investigating', title: 'Active', tone: 'text-bad' },
  { status: 'monitoring', title: 'Monitoring', tone: 'text-warn' },
  { status: 'resolved', title: 'Resolved', tone: 'text-ok' },
];

export function Incidents() {
  const { incidents, setDeclareOpen } = useIncidents();
  const { matches, allowedProducts } = useProductFilter();
  const { inRange, label } = useDateRange();
  const { canDo } = useAuth();
  const f = useUrlFilters(keys);
  const v = f.values;

  const scoped = incidents.filter((i) => matches(i.product));
  const filtered = useMemo(
    () =>
      scoped.filter(
        (i) =>
          (!v.q || `${i.id} ${i.title} ${i.service}`.toLowerCase().includes(v.q.toLowerCase())) &&
          (!v.severity || i.severity === v.severity) &&
          (!v.status || i.status === v.status) &&
          (!v.product || i.product === v.product) &&
          (!v.service || i.service === v.service) &&
          (!v.owner || i.owner === v.owner) &&
          (i.status !== 'resolved' || inRange(parseWhen(i.started))),
      ),
    [scoped, v, inRange],
  );

  const open = scoped.filter((i) => i.status !== 'resolved');
  const resolved = scoped.filter((i) => i.status === 'resolved');
  const records = incidentRecords(incidents).filter(
    (r) => matches(r.product) && inRange(r.started),
  );
  const services = Array.from(new Set(scoped.map((i) => i.service)));
  const owners = Array.from(new Set(scoped.map((i) => i.owner)));
  const apply = useCallback(
    (vals: Record<string, string>) =>
      f.setMany(Object.fromEntries(keys.map((k) => [k, vals[k] ?? '']))),
    [f],
  );

  const worst = [...open].sort((a, b) => a.severity.localeCompare(b.severity))[0];

  return (
    <div className="space-y-3.5">
      <PageHero
        tint={open.length ? 'bad' : 'accent'}
        illustration={<FirefighterIllustration className="h-[84px] w-auto" />}
        title="Incidents"
        description={
          worst ? (
            <>
              <b className="font-semibold text-ink">{open.length} open</b> — highest is{' '}
              <b className="font-semibold text-bad">{worst.severity}</b> on {worst.service}. Each
              incident links product, deploy, code and owner.
            </>
          ) : (
            'All quiet. Incidents link product, deploy, code and owner so investigations start from one view.'
          )
        }
        actions={
          canDo('incident:declare') ? (
            <Button
              size="sm"
              variant="danger"
              icon={<SirenIcon className="h-3.5 w-3.5" />}
              onClick={() => setDeclareOpen(true)}
            >
              Declare incident
            </Button>
          ) : undefined
        }
      />

      <StatStrip>
        <StatCard
          label="Open"
          value={open.length}
          note="Unresolved right now"
          tone={open.length ? 'bad' : 'ok'}
          to="/incidents"
        />
        <StatCard
          label="SEV1 open"
          value={open.filter((i) => i.severity === 'SEV1').length}
          note="Highest severity"
          tone={open.some((i) => i.severity === 'SEV1') ? 'bad' : 'neutral'}
        />
        <StatCard
          label="SEV2 open"
          value={open.filter((i) => i.severity === 'SEV2').length}
          note="Degraded service"
        />
        <StatCard
          label="SEV3 open"
          value={open.filter((i) => i.severity === 'SEV3').length}
          note="Limited impact"
        />
        <StatCard
          label="MTTR"
          value={formatDuration(mttr(records))}
          note={`${records.filter((r) => r.minutes !== null).length} resolved records`}
        />
        <StatCard
          label={`Resolved · ${label.toLowerCase()}`}
          value={resolved.length}
          note="Closed incidents on record"
          tone={resolved.length ? 'ok' : 'neutral'}
        />
      </StatStrip>

      <FilterBar
        id="incidents"
        values={v}
        onChange={(k, val) => f.set(k as (typeof keys)[number], val)}
        onApply={apply}
        onReset={f.reset}
        activeCount={f.activeCount}
        count={filtered.length}
        noun="incidents"
        search={{ key: 'q', placeholder: 'Search incidents…' }}
        selects={[
          {
            key: 'severity',
            label: 'Severity',
            options: ['SEV1', 'SEV2', 'SEV3'].map((s) => ({ value: s, label: s })),
          },
          {
            key: 'status',
            label: 'Status',
            options: groups.map((g) => ({ value: g.status, label: g.title })),
          },
          {
            key: 'product',
            label: 'Product',
            options: allowedProducts.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            key: 'service',
            label: 'Service',
            options: services.map((s) => ({ value: s, label: s })),
          },
          {
            key: 'owner',
            label: 'Owner',
            options: owners.map((o) => ({
              value: o,
              label: members.find((m) => m.id === o)?.name ?? o,
            })),
          },
        ]}
        presets={[
          { label: 'Active only', values: { status: 'investigating' } },
          { label: 'High severity', values: { severity: 'SEV1' } },
        ]}
      />

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section
          className="min-w-0 overflow-hidden rounded-lg border border-line bg-white"
          aria-label="Incident list"
        >
          <IncidentRowHeader />
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center sm:flex-row sm:justify-center sm:text-left">
              <EmptyIllustration className="h-16 w-auto" />
              <div>
                <p className="text-[12.5px] font-semibold text-ink">No incidents match</p>
                <p className="text-[12px] text-muted">
                  Resolved incidents follow the date range — try a wider range or clear filters.
                </p>
              </div>
            </div>
          ) : (
            groups.map((g) => {
              const items = filtered.filter((i) => i.status === g.status);
              if (items.length === 0) return null;
              return (
                <section key={g.status} aria-label={g.title}>
                  <h2
                    className={`flex items-center gap-2 border-b border-line bg-sunken/40 px-3.5 py-1.5 text-[11.5px] font-semibold ${g.tone}`}
                  >
                    {g.title}
                    <span className="font-medium tabular-nums text-muted">{items.length}</span>
                  </h2>
                  <ul className="divide-y divide-line border-b border-line last:border-0">
                    {items.map((i) => (
                      <IncidentRow key={i.id} incident={i} />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </section>
        <IncidentAnalytics />
      </div>
    </div>
  );
}
