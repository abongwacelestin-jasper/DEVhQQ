import { daysAgo } from '../../utils/metrics';
import type { Deployment } from '../../types/operations';

/**
 * Deploys per day for the last week, counted from the rows the API returned.
 * Nothing is seeded: a quiet week renders flat, and the success rate is the
 * measured one, not a target.
 */
export function DeployFrequencyChart({
  rows,
  height = 120,
}: {
  rows: Deployment[];
  height?: number;
}) {
  const week = rows.filter((d) => daysAgo(d.ago) < 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const label = new Date(Date.now() - offset * 86_400_000).toLocaleDateString('en-US', {
      weekday: 'short',
    });
    const items = week.filter((d) => daysAgo(d.ago) === offset);
    const failed = items.filter((d) => d.status === 'failed' || d.status === 'rolled-back').length;
    return { label, ok: items.length - failed, failed };
  });

  const total = week.length;
  const failed = week.filter((d) => d.status === 'failed' || d.status === 'rolled-back').length;
  const max = Math.max(1, ...days.map((d) => d.ok + d.failed));
  const rate = total ? Math.round(((total - failed) / total) * 100) : 0;

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[19px] font-semibold tabular-nums leading-none text-ink">
          {total}
        </span>
        <span className="truncate text-[11px] text-muted">
          {total ? `deploys · ${rate}% succeeded` : 'no deploys recorded in 7 days'}
        </span>
      </div>
      <div
        className="mt-3 flex items-end gap-1.5"
        style={{ height }}
        role="img"
        aria-label={`Deploys per day over the last 7 days, ${failed} failed of ${total}`}
      >
        {days.map((d) => {
          const n = d.ok + d.failed;
          return (
            <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] tabular-nums text-subtle">{n || ''}</span>
              <div
                className="flex w-full flex-col overflow-hidden rounded"
                style={{ height: `${(n / max) * 100}%`, minHeight: n ? 4 : 2 }}
              >
                {d.failed > 0 && <div className="bg-bad" style={{ flex: d.failed }} />}
                <div className={n ? 'bg-accent' : 'bg-line'} style={{ flex: d.ok || 1 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5">
        {days.map((d) => (
          <span key={d.label} className="flex-1 text-center text-[10px] text-subtle">
            {d.label}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-3 text-[10.5px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-accent" />
          Succeeded
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-bad" />
          Failed / rolled back
        </span>
      </div>
    </div>
  );
}
