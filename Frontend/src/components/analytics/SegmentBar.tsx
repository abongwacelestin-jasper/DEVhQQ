import type { Tone } from '../../types/portfolio';
import { toneDot } from '../../utils/status';

interface Segment {
  label: string;
  value: number;
  tone: Tone;
}

/** Horizontal stacked bar with an inline legend. */
export function SegmentBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-sunken"
        role="img"
        aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}
      >
        {total > 0 &&
          segments.map((s) =>
            s.value ? (
              <span
                key={s.label}
                className={`${toneDot[s.tone]} h-full border-r border-white last:border-0`}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ) : null,
          )}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1 text-[11px] text-ink">
            <span className={`h-1.5 w-1.5 rounded-full ${toneDot[s.tone]}`} />
            {s.label}
            <span className="font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
