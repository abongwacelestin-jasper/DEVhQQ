import type { DeploymentRow } from '../../hooks/useDeployments';
import { frequencyByDay } from './environments';

/**
 * Deploys per day, counted from the records the API returned (by `createdAt`).
 * Nothing is seeded: a quiet week renders flat, and the success rate is the
 * measured one, not a target.
 */
export function DeployFrequencyChart({
  rows,
  days = 7,
  height = 120,
}: {
  rows: DeploymentRow[];
  days?: number;
  height?: number;
}) {
  const buckets = frequencyByDay(rows, days);
  const total = buckets.reduce((n, b) => n + b.total, 0);
  const failed = buckets.reduce((n, b) => n + b.failed, 0);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const rate = total ? Math.round(((total - failed) / total) * 100) : 0;
  const label = (d: Date) =>
    days <= 7
      ? d.toLocaleDateString('en-US', { weekday: 'short' })
      : d.toLocaleDateString('en-US', { day: 'numeric' });

  return (
    <figure className="px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[19px] font-semibold tabular-nums leading-none text-ink">
          {total}
        </span>
        <span className="truncate text-[11px] text-muted">
          {total ? `deploys · ${rate}% succeeded` : `no deploys recorded in ${days} days`}
        </span>
      </div>
      <div
        className="mt-3 flex items-end gap-1.5"
        style={{ height }}
        role="img"
        aria-label={`Deploys per day over the last ${days} days: ${total} total, ${failed} failed or rolled back`}
      >
        {buckets.map((b) => {
          const ok = b.total - b.failed;
          return (
            <div key={b.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] tabular-nums text-subtle">{b.total || ''}</span>
              <div
                className="flex w-full flex-col overflow-hidden rounded"
                style={{ height: `${(b.total / max) * 100}%`, minHeight: b.total ? 4 : 2 }}
                title={`${b.day}: ${b.total} deploys, ${b.failed} failed`}
              >
                {b.failed > 0 && <div className="bg-bad" style={{ flex: b.failed }} />}
                <div className={b.total ? 'bg-accent' : 'bg-line'} style={{ flex: ok || 1 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5" aria-hidden>
        {buckets.map((b) => (
          <span key={b.day} className="flex-1 text-center text-[10px] text-subtle">
            {label(b.date)}
          </span>
        ))}
      </div>
      <figcaption className="mt-2.5 flex items-center gap-3 text-[10.5px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-accent" />
          Succeeded
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-bad" />
          Failed / rolled back
        </span>
      </figcaption>
    </figure>
  );
}

export default DeployFrequencyChart;
