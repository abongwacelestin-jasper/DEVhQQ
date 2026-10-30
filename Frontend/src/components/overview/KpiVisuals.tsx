/** Small, data-shaped visuals for the Overview KPI strip. Each one fits a 24px-tall slot. */

export interface Segment {
  label: string;
  value: number;
  className: string;
}

/** Horizontal split bar with an inline legend — for "share of a whole" counts. */
export function SplitBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  return (
    <div
      className="w-full"
      role="img"
      aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}
    >
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-sunken">
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.label}
                className={`h-full ${s.className}`}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ))}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
        {segments.map((s) => (
          <span key={s.label} className="flex min-w-0 items-center gap-1 text-[10.5px] text-muted">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-sm ${s.className}`} />
            <span className="truncate">{s.label}</span>
            <b className="font-semibold tabular-nums text-ink">{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Count pills — for small discrete breakdowns like review age or severity. */
export function CountPills({
  items,
  label,
}: {
  items: { label: string; value: number; tone: 'bad' | 'warn' | 'info' | 'ok' | 'neutral' }[];
  label: string;
}) {
  const tones = {
    bad: 'bg-bad-soft text-bad',
    warn: 'bg-warn-soft text-warn',
    info: 'bg-info-soft text-info',
    ok: 'bg-ok-soft text-ok',
    neutral: 'bg-sunken text-muted',
  };
  return (
    <ul className="flex flex-wrap gap-1" aria-label={label}>
      {items.map((i) => (
        <li
          key={i.label}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[10.5px] font-medium ${i.value === 0 ? tones.neutral + ' opacity-70' : tones[i.tone]}`}
        >
          {i.label}
          <b className="font-semibold tabular-nums">{i.value}</b>
        </li>
      ))}
    </ul>
  );
}

/** Daily columns stacked success (bottom) over failure (top). */
export function OutcomeColumns({
  days,
  label,
}: {
  days: { day: string; ok: number; failed: number }[];
  label: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.ok + d.failed));
  return (
    <div className="w-full">
      <div
        className="flex h-7 items-end gap-[3px]"
        role="img"
        aria-label={`${label}: ${days.map((d) => `${d.day} ${d.ok} ok ${d.failed} failed`).join('; ')}`}
      >
        {days.map((d) => {
          const total = d.ok + d.failed;
          return (
            <span
              key={d.day}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${d.day}: ${d.ok} succeeded, ${d.failed} failed`}
            >
              {total === 0 ? (
                <span className="h-[2px] rounded-sm bg-line" />
              ) : (
                <span
                  className="flex flex-col overflow-hidden rounded-[2px]"
                  style={{ height: `${Math.max(12, (total / max) * 100)}%` }}
                >
                  {d.failed > 0 && <span className="bg-bad" style={{ flexGrow: d.failed }} />}
                  {d.ok > 0 && <span className="bg-ok" style={{ flexGrow: d.ok }} />}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div className="mt-0.5 flex gap-[3px]">
        {days.map((d) => (
          <span key={d.day} className="flex-1 text-center text-[9px] leading-none text-subtle">
            {d.day[0]}
          </span>
        ))}
      </div>
    </div>
  );
}
