import type { Tone } from '../../types/portfolio';
import { toneDot } from '../../utils/status';

interface MiniBarsProps {
  values: number[];
  labels?: string[];
  tone?: Tone;
  height?: number;
  label: string;
  showLabels?: boolean;
}

/** Compact vertical bars; hover a bar to see its label and value. */
export function MiniBars({
  values,
  labels,
  tone = 'accent',
  height = 36,
  label,
  showLabels = false,
}: MiniBarsProps) {
  if (values.length === 0) return <p className="text-[11px] text-muted">No data in range</p>;
  const max = Math.max(...values, 1);
  return (
    <figure className="m-0" aria-label={label}>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className={`w-full rounded-sm ${v ? toneDot[tone] : 'bg-sunken'}`}
              style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
            />
            <span className="pointer-events-none absolute -top-5 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-white group-hover:block">
              {labels?.[i] ? `${labels[i]} · ` : ''}
              {v}
            </span>
          </div>
        ))}
      </div>
      {showLabels && labels ? (
        <figcaption className="mt-0.5 flex gap-[3px] text-[9.5px] text-muted">
          {labels.map((l, i) => (
            <span key={i} className="min-w-0 flex-1 truncate text-center">
              {l}
            </span>
          ))}
        </figcaption>
      ) : labels && labels.length > 1 ? (
        <figcaption className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
