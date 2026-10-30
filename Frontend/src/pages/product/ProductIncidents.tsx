import { useCallback } from 'react';
import { IncidentRow, IncidentRowHeader } from '../../components/operations/IncidentRow';
import { DeliveryReliabilityCards } from '../../components/analytics/DeliveryReliabilityCards';
import { useIncidents } from '../../contexts/IncidentContext';
import { useProductTab, textMatch } from '../../hooks/useProductTab';
import { pastIncidents } from '../../data/incidentHistory';
import { formatDuration } from '../../utils/metrics';
import type { ProductId } from '../../types/portfolio';

export function ProductIncidents() {
  const { product, filters } = useProductTab();
  const { incidents } = useIncidents();
  const match = useCallback((p: ProductId) => p === product.id, [product.id]);
  const list = incidents.filter(
    (i) =>
      i.product === product.id &&
      textMatch(filters.q, i.id, i.title, i.service) &&
      (!filters.person || i.owner === filters.person) &&
      (!filters.status || i.status === filters.status),
  );
  const past = pastIncidents.filter(
    (p) =>
      p.product === product.id &&
      textMatch(filters.q, p.id, p.title, p.service) &&
      (!filters.person || p.owner === filters.person),
  );

  return (
    <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3.5">
        <section
          className="overflow-hidden rounded-lg border border-line bg-white"
          aria-label="Current incidents"
        >
          <h2 className="border-b border-line px-3.5 py-2 text-[12.5px] font-semibold text-ink">
            Current &amp; recent
          </h2>
          <IncidentRowHeader />
          {list.length === 0 ? (
            <p className="px-3.5 py-4 text-[12.5px] text-muted">No incidents match.</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((i) => (
                <IncidentRow key={i.id} incident={i} />
              ))}
            </ul>
          )}
        </section>
        <section
          className="overflow-hidden rounded-lg border border-line bg-white"
          aria-label="Resolved history"
        >
          <h2 className="border-b border-line px-3.5 py-2 text-[12.5px] font-semibold text-ink">
            Resolved history · 90 days
          </h2>
          <ul className="divide-y divide-line">
            {past.map((p) => (
              <li
                key={p.id}
                className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-1.5 text-[12px] md:grid-cols-[52px_minmax(0,1fr)_140px_110px_70px]"
              >
                <span className="font-semibold text-ink">{p.severity}</span>
                <span className="min-w-0 truncate text-ink">
                  <span className="font-mono text-muted">{p.id}</span> {p.title}
                </span>
                <span className="hidden truncate font-mono text-[11.5px] text-ink md:block">
                  {p.service}
                </span>
                <span className="hidden text-muted md:block">{p.started}</span>
                <span className="text-right tabular-nums text-ink">
                  {formatDuration(p.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <DeliveryReliabilityCards match={match} />
    </div>
  );
}
