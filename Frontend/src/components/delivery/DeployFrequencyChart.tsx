import { deployFrequency } from '../../data/engineering';

export function DeployFrequencyChart({ height = 120 }: { height?: number }) {
  const max = Math.max(...deployFrequency.map((d) => d.ok + d.failed), 1);
  const total = deployFrequency.reduce((s, d) => s + d.ok + d.failed, 0);
  const failed = deployFrequency.reduce((s, d) => s + d.failed, 0);
  return (
    <div className="px-4 py-4">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink">{total}</span>
        <span className="text-xs text-muted">
          deploys · {Math.round(((total - failed) / total) * 100)}% success · median lead time 1.8d
        </span>
      </div>
      <div
        className="mt-4 flex items-end gap-2"
        style={{ height }}
        role="img"
        aria-label={`Deploys per day over the last 7 days, ${failed} failed`}
      >
        {deployFrequency.map((d) => {
          const n = d.ok + d.failed;
          return (
            <div
              key={d.day}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
            >
              <span className="text-[10px] tabular-nums text-subtle">{n || ''}</span>
              <div
                className="flex w-full max-w-[36px] flex-col overflow-hidden rounded-md"
                style={{ height: `${(n / max) * 100}%`, minHeight: n ? 4 : 2 }}
              >
                {d.failed > 0 && <div className="bg-bad" style={{ flex: d.failed }} />}
                <div className={n ? 'bg-accent' : 'bg-line'} style={{ flex: d.ok || 1 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {deployFrequency.map((d) => (
          <span key={d.day} className="flex-1 text-center text-[11px] text-subtle">
            {d.day}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-accent" />
          Succeeded
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-bad" />
          Failed
        </span>
      </div>
    </div>
  );
}
