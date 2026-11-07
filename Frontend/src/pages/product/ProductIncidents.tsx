import { useCallback } from 'react';
import { IncidentRow, IncidentRowHeader } from '../../components/operations/IncidentRow';
import { DeliveryReliabilityCards } from '../../components/analytics/DeliveryReliabilityCards';
import { DataState } from '../../components/engineering/states';
import { useIncidents } from '../../contexts/IncidentContext';
import { useProductTab, textMatch } from '../../hooks/useProductTab';
import type { Incident } from '../../types/operations';
import type { ProductId } from '../../types/portfolio';

/** One product's incidents, open and resolved, straight from `/api/incidents`. */
export function ProductIncidents() {
  const { product, filters } = useProductTab();
  const { incidents, loading, error, reload } = useIncidents();
  const match = useCallback((p: ProductId) => p === product.id, [product.id]);
  const list = incidents.filter(
    (i) =>
      i.product === product.id &&
      textMatch(filters.q, i.id, i.title, i.service) &&
      (!filters.person || i.owner === filters.person) &&
      (!filters.status || i.status === filters.status),
  );
  const open = list.filter((i) => i.status !== 'resolved');
  const resolved = list.filter((i) => i.status === 'resolved');
  const blocked = (loading || error) && incidents.length === 0;

  const section = (label: string, rows: Incident[], empty: string) => (
    <section className="overflow-hidden rounded-lg border border-line bg-white" aria-label={label}>
      <h2 className="border-b border-line px-3.5 py-2 text-[12.5px] font-semibold text-ink">
        {label} <span className="font-medium tabular-nums text-muted">{rows.length}</span>
      </h2>
      <IncidentRowHeader />
      {rows.length === 0 ? (
        <p className="px-3.5 py-4 text-[12.5px] text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((i) => (
            <IncidentRow key={i.id} incident={i} />
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3.5">
        {blocked ? (
          <DataState
            status={loading ? 'loading' : 'error'}
            error={error}
            what="Incidents"
            onRetry={() => void reload().catch(() => undefined)}
          />
        ) : (
          <>
            {section('Open', open, 'No open incidents match.')}
            {section('Resolved', resolved, 'No resolved incidents on record for this product.')}
          </>
        )}
      </div>
      <DeliveryReliabilityCards match={match} />
    </div>
  );
}
